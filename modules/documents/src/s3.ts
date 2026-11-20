/**
 * The archive's files in S3-compatible object storage (ADR 0038): the insurer's
 * in production, SeaweedFS in docker compose locally. Files never change: a
 * put to a key that exists is refused by the store (If-None-Match).
 */
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { BlobStore } from './index.ts';

export interface S3Config {
  bucket: string;
  /** e.g. http://127.0.0.1:8333 for SeaweedFS. Omitted: AWS. */
  endpoint?: string;
  region?: string;
  /** Omitted: the SDK's usual credentials (environment, profile or role). */
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class S3BlobStore implements BlobStore {
  private readonly s3: S3Client;

  constructor(private readonly config: S3Config) {
    this.s3 = new S3Client({
      region: config.region ?? 'eu-north-1',
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      ...(config.accessKeyId && config.secretAccessKey ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } } : {}),
    });
  }

  async put(key: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: mediaType, ContentLength: bytes.length, IfNoneMatch: '*' }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  /** Checks that the bucket answers, for the health check. */
  async ping(): Promise<void> {
    await this.get('petvold-ping');
  }

  destroy(): void {
    this.s3.destroy();
  }
}

/** The archive's settings from the environment: PETVOLD_DOCUMENTS_BUCKET and the rest. null without a bucket. */
export function s3ConfigFromEnv(env: Record<string, string | undefined>): S3Config | null {
  if (!env.PETVOLD_DOCUMENTS_BUCKET) return null;
  return {
    bucket: env.PETVOLD_DOCUMENTS_BUCKET,
    ...(env.PETVOLD_DOCUMENTS_S3_ENDPOINT ? { endpoint: env.PETVOLD_DOCUMENTS_S3_ENDPOINT } : {}),
    ...(env.PETVOLD_DOCUMENTS_S3_REGION ? { region: env.PETVOLD_DOCUMENTS_S3_REGION } : {}),
    ...(env.PETVOLD_DOCUMENTS_S3_ACCESS_KEY ? { accessKeyId: env.PETVOLD_DOCUMENTS_S3_ACCESS_KEY } : {}),
    ...(env.PETVOLD_DOCUMENTS_S3_SECRET_KEY ? { secretAccessKey: env.PETVOLD_DOCUMENTS_S3_SECRET_KEY } : {}),
  };
}
