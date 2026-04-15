import { CACHE_CAP } from '../config.js';
import { LRUCache } from './lru.js';

export const apiCache = new LRUCache(CACHE_CAP);
export const canonCache = new LRUCache(2000);
export const rawDataCache = new LRUCache(500);
