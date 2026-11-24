import { createHmac } from 'node:crypto';
import { loadHashKey } from '../../adapters/pseudonym';

/** Seals the head of an audit chain (length + last hash) with the server key. */
export const seal = (chainId: string, seq: number, hash: string) => createHmac('sha256', loadHashKey()).update(`audit|${chainId}|${seq}|${hash}`).digest('hex');
