export class LRUNode {
  constructor(key, value, ttlMs = Infinity) {
    this.key = key;
    this.value = value;
    this.expiresAt = ttlMs === Infinity ? Infinity : Date.now() + Math.max(0, ttlMs);
    this.prev = null;
    this.next = null;
  }
}

export class LRUCache {
  constructor(capacity, options = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('LRUCache capacity must be a positive integer');
    }

    this.capacity = capacity;
    this.defaultTtlMs = options.defaultTtlMs ?? Infinity;
    this.map = new Map();
    this.head = new LRUNode(null, null, Infinity);
    this.tail = new LRUNode(null, null, Infinity);
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
  }

  _attachFront(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _isExpired(node, now = Date.now()) {
    return now > node.expiresAt;
  }

  _deleteNode(node, reason) {
    this._detach(node);
    this.map.delete(node.key);
    if (reason === 'expired') this.expirations += 1;
    if (reason === 'evicted') this.evictions += 1;
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) {
      this.misses += 1;
      return null;
    }

    if (this._isExpired(node)) {
      this._deleteNode(node, 'expired');
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    this._detach(node);
    this._attachFront(node);
    return node.value;
  }

  put(key, value, ttlMs = this.defaultTtlMs) {
    const existing = this.map.get(key);
    if (existing) this._deleteNode(existing, 'replaced');

    const node = new LRUNode(key, value, ttlMs);
    this._attachFront(node);
    this.map.set(key, node);

    while (this.map.size > this.capacity) {
      this._deleteNode(this.tail.prev, 'evicted');
    }
  }

  delete(key) {
    const node = this.map.get(key);
    if (!node) return false;
    this._deleteNode(node, 'deleted');
    return true;
  }

  clear() {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  pruneExpired(now = Date.now()) {
    let pruned = 0;
    for (const node of [...this.map.values()]) {
      if (this._isExpired(node, now)) {
        this._deleteNode(node, 'expired');
        pruned += 1;
      }
    }
    return pruned;
  }

  stats() {
    const requests = this.hits + this.misses;
    return {
      capacity: this.capacity,
      size: this.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: requests === 0 ? 0 : +(this.hits / requests).toFixed(4),
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }

  get size() {
    return this.map.size;
  }
}
