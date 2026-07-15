import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env/server';
import { relations } from './relations';

export const db = drizzle(env.DATABASE_URL, { relations });
