const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class TaskScheduler extends EventEmitter {
    constructor(config = {}) {
        super();
        this.redis = new Redis(config.redis || {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD
        });

        // 任务队列键
        this.queues = {
            pending: 'crawler:tasks:pending',
            processing: 'crawler:tasks:processing',
            completed: 'crawler:tasks:completed',
            failed: 'crawler:tasks:failed'
        };

        // 工作节点信息
        this.workers = {
            list: 'crawler:workers:list',
            status: 'crawler:workers:status',
            heartbeat: 'crawler:workers:heartbeat'
        };

        // 任务结果存储
        this.results = 'crawler:results';

        // 监控间隔（毫秒）
        this.monitorInterval = 5000;
        
        // 启动监控
        this.startMonitoring();
    }

    async initialize() {
        // 清理之前可能存在的僵尸任务
        await this.cleanupStaleJobs();
        console.log('任务调度器初始化完成');
    }

    async addTask(url, options = {}) {
        const taskId = uuidv4();
        const task = {
            id: taskId,
            url,
            options,
            status: 'pending',
            createdAt: Date.now(),
            priority: options.priority || 0,
            retries: 0,
            maxRetries: options.maxRetries || 3
        };

        // 将任务添加到待处理队列
        await this.redis.lpush(this.queues.pending, JSON.stringify(task));
        console.log(`添加新任务: ${taskId} - ${url}`);
        
        return taskId;
    }

    async addBatchTasks(urls, options = {}) {
        const tasks = urls.map(url => ({
            id: uuidv4(),
            url,
            options,
            status: 'pending',
            createdAt: Date.now(),
            priority: options.priority || 0,
            retries: 0,
            maxRetries: options.maxRetries || 3
        }));

        // 批量添加任务
        const pipeline = this.redis.pipeline();
        tasks.forEach(task => {
            pipeline.lpush(this.queues.pending, JSON.stringify(task));
        });
        await pipeline.exec();

        console.log(`批量添加 ${tasks.length} 个任务`);
        return tasks.map(t => t.id);
    }

    async getNextTask(workerId) {
        // 获取并移动任务到处理中队列
        const taskStr = await this.redis.rpoplpush(
            this.queues.pending,
            this.queues.processing
        );

        if (!taskStr) return null;

        const task = JSON.parse(taskStr);
        task.workerId = workerId;
        task.startedAt = Date.now();

        // 更新任务状态
        await this.redis.lset(
            this.queues.processing,
            -1,
            JSON.stringify(task)
        );

        return task;
    }

    async completeTask(taskId, result) {
        const task = await this.findTask(taskId);
        if (!task) return false;

        // 移除处理中的任务
        await this.redis.lrem(this.queues.processing, 0, JSON.stringify(task));

        // 添加到完成队列
        task.status = 'completed';
        task.completedAt = Date.now();
        task.result = result;

        await Promise.all([
            this.redis.lpush(this.queues.completed, JSON.stringify(task)),
            this.redis.hset(this.results, taskId, JSON.stringify(result))
        ]);

        this.emit('taskCompleted', task);
        return true;
    }

    async failTask(taskId, error) {
        const task = await this.findTask(taskId);
        if (!task) return false;

        // 检查是否需要重试
        if (task.retries < task.maxRetries) {
            task.retries++;
            task.status = 'pending';
            delete task.workerId;
            delete task.startedAt;

            // 将任务重新加入待处理队列
            await Promise.all([
                this.redis.lrem(this.queues.processing, 0, JSON.stringify(task)),
                this.redis.lpush(this.queues.pending, JSON.stringify(task))
            ]);

            console.log(`任务 ${taskId} 失败，进行第 ${task.retries} 次重试`);
            return true;
        }

        // 超过重试次数，标记为失败
        await this.redis.lrem(this.queues.processing, 0, JSON.stringify(task));
        task.status = 'failed';
        task.error = error.message;
        task.failedAt = Date.now();

        await this.redis.lpush(this.queues.failed, JSON.stringify(task));
        this.emit('taskFailed', task);
        return false;
    }

    async registerWorker(workerId, info = {}) {
        const worker = {
            id: workerId,
            info,
            status: 'active',
            registeredAt: Date.now(),
            lastHeartbeat: Date.now()
        };

        await Promise.all([
            this.redis.hset(this.workers.status, workerId, JSON.stringify(worker)),
            this.redis.sadd(this.workers.list, workerId)
        ]);

        console.log(`工作节点注册: ${workerId}`);
        return worker;
    }

    async updateWorkerHeartbeat(workerId) {
        const worker = await this.getWorker(workerId);
        if (!worker) return false;

        worker.lastHeartbeat = Date.now();
        await this.redis.hset(
            this.workers.status,
            workerId,
            JSON.stringify(worker)
        );
        return true;
    }

    async getWorker(workerId) {
        const workerStr = await this.redis.hget(this.workers.status, workerId);
        return workerStr ? JSON.parse(workerStr) : null;
    }

    async getActiveWorkers() {
        const workers = await this.redis.hgetall(this.workers.status);
        const now = Date.now();
        const activeWorkers = [];

        for (const [id, workerStr] of Object.entries(workers)) {
            const worker = JSON.parse(workerStr);
            if (now - worker.lastHeartbeat < 30000) { // 30秒内有心跳的认为是活跃的
                activeWorkers.push(worker);
            }
        }

        return activeWorkers;
    }

    async findTask(taskId) {
        // 在所有队列中查找任务
        for (const queue of Object.values(this.queues)) {
            const tasks = await this.redis.lrange(queue, 0, -1);
            for (const taskStr of tasks) {
                const task = JSON.parse(taskStr);
                if (task.id === taskId) return task;
            }
        }
        return null;
    }

    async getTaskStatus(taskId) {
        const task = await this.findTask(taskId);
        if (!task) return null;

        const result = task.status === 'completed' 
            ? await this.redis.hget(this.results, taskId)
            : null;

        return {
            status: task.status,
            result: result ? JSON.parse(result) : null,
            error: task.error,
            progress: task.progress
        };
    }

    async cleanupStaleJobs() {
        // 清理超时的处理中任务
        const processingTasks = await this.redis.lrange(this.queues.processing, 0, -1);
        const now = Date.now();
        const staleTimeout = 30 * 60 * 1000; // 30分钟超时

        for (const taskStr of processingTasks) {
            const task = JSON.parse(taskStr);
            if (now - task.startedAt > staleTimeout) {
                await this.failTask(task.id, new Error('任务处理超时'));
            }
        }
    }

    startMonitoring() {
        setInterval(async () => {
            try {
                // 清理僵尸任务
                await this.cleanupStaleJobs();

                // 检查工作节点状态
                const workers = await this.getActiveWorkers();
                this.emit('monitoring', {
                    activeWorkers: workers.length,
                    pendingTasks: await this.redis.llen(this.queues.pending),
                    processingTasks: await this.redis.llen(this.queues.processing),
                    completedTasks: await this.redis.llen(this.queues.completed),
                    failedTasks: await this.redis.llen(this.queues.failed)
                });
            } catch (error) {
                console.error('监控错误:', error);
            }
        }, this.monitorInterval);
    }

    async shutdown() {
        await this.redis.quit();
    }
}

module.exports = TaskScheduler; 