export class MediaTaskQueueFullError extends Error {
  constructor(message = '媒体任务队列已满，请稍后重试') {
    super(message);
    this.name = 'MediaTaskQueueFullError';
  }
}

export class MediaTaskQueueCancelledError extends Error {
  constructor(message = '媒体任务已取消') {
    super(message);
    this.name = 'MediaTaskQueueCancelledError';
  }
}

function normalizeLimit(value, fallback) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

export function createMediaTaskScheduler(options = {}) {
  const maxConcurrent = normalizeLimit(options.maxConcurrent, 4);
  const limitsByType = {
    image: Math.min(normalizeLimit(options.imageMaxConcurrent, 3), maxConcurrent),
    video: Math.min(normalizeLimit(options.videoMaxConcurrent, 1), maxConcurrent),
  };
  const ownerMaxConcurrent = normalizeLimit(options.ownerMaxConcurrent, 1);
  const maxQueued = normalizeLimit(options.maxQueued, 24);
  const maxQueuedPerOwner = normalizeLimit(options.maxQueuedPerOwner, 2);
  const queue = [];
  const activeJobs = new Map();
  let activeSlots = 0;
  const activeByType = { image: 0, video: 0 };
  const activeByOwner = new Map();

  function getOwnerActiveCount(ownerId) {
    return activeByOwner.get(ownerId) || 0;
  }

  function canStart(job) {
    return activeSlots + job.slots <= maxConcurrent
      && activeByType[job.type] + job.slots <= limitsByType[job.type]
      && getOwnerActiveCount(job.ownerId) < ownerMaxConcurrent;
  }

  function release(job) {
    activeJobs.delete(job.id);
    activeSlots -= job.slots;
    activeByType[job.type] -= job.slots;
    const ownerActiveCount = getOwnerActiveCount(job.ownerId) - 1;
    if (ownerActiveCount > 0) {
      activeByOwner.set(job.ownerId, ownerActiveCount);
    } else {
      activeByOwner.delete(job.ownerId);
    }
    pump();
  }

  function start(job) {
    activeJobs.set(job.id, job);
    activeSlots += job.slots;
    activeByType[job.type] += job.slots;
    activeByOwner.set(job.ownerId, getOwnerActiveCount(job.ownerId) + 1);
    const execution = (async () => {
      try {
        job.onStart?.();
        return await job.run();
      } finally {
        release(job);
      }
    })();
    execution.then(job.resolve, job.reject);
  }

  function pump() {
    while (activeSlots < maxConcurrent && queue.length) {
      const nextIndex = queue.findIndex(canStart);
      if (nextIndex === -1) {
        return;
      }
      const [job] = queue.splice(nextIndex, 1);
      start(job);
    }
  }

  function schedule(input) {
    const id = String(input?.id || '').trim();
    const type = String(input?.type || '').trim();
    const ownerId = String(input?.ownerId || '').trim();
    if (!id || !ownerId || !Object.hasOwn(limitsByType, type) || typeof input?.run !== 'function') {
      return Promise.reject(new TypeError('媒体任务参数不完整'));
    }
    if (activeJobs.has(id) || queue.some(job => job.id === id)) {
      return Promise.reject(new TypeError(`媒体任务已存在: ${id}`));
    }

    const slots = normalizeLimit(input?.slots, 1);
    if (slots > maxConcurrent || slots > limitsByType[type]) {
      return Promise.reject(new TypeError('媒体任务并发数超过限制'));
    }
    const job = { ...input, id, type, ownerId, slots };
    const startsImmediately = canStart(job);
    if (!startsImmediately) {
      const queuedForOwner = queue.filter(queuedJob => queuedJob.ownerId === ownerId).length;
      if (queue.length >= maxQueued) {
        return Promise.reject(new MediaTaskQueueFullError());
      }
      if (queuedForOwner >= maxQueuedPerOwner) {
        return Promise.reject(new MediaTaskQueueFullError('该用户排队中的媒体任务过多，请等待当前任务完成'));
      }
    }

    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    if (startsImmediately) {
      start(job);
    } else {
      queue.push(job);
      pump();
    }
    return promise;
  }

  function cancel(taskId) {
    const normalizedTaskId = String(taskId || '').trim();
    const index = queue.findIndex(job => job.id === normalizedTaskId);
    if (index === -1) {
      return false;
    }
    const [job] = queue.splice(index, 1);
    job.reject(new MediaTaskQueueCancelledError());
    pump();
    return true;
  }

  function getQueuePosition(taskId) {
    const normalizedTaskId = String(taskId || '').trim();
    const index = queue.findIndex(job => job.id === normalizedTaskId);
    return index === -1 ? 0 : index + 1;
  }

  function getStats() {
    return {
      active: activeJobs.size,
      activeSlots,
      queued: queue.length,
      activeByType: { ...activeByType },
    };
  }

  return {
    schedule,
    cancel,
    getQueuePosition,
    getStats,
  };
}
