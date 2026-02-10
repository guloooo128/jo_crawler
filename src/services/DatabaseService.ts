import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';
import type { JobData } from '../models/JobData.js';

/**
 * SQLite 数据库服务
 * 负责职位数据的持久化存储和去重
 */
export class DatabaseService {
  private db!: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'output', 'jobs.db');
  }

  /**
   * 初始化数据库（建表 + 索引）
   */
  async init(): Promise<void> {
    // 确保目录存在
    await fs.ensureDir(path.dirname(this.dbPath));

    this.db = new Database(this.dbPath);

    // 启用 WAL 模式（提升并发写入性能）
    this.db.pragma('journal_mode = WAL');

    // 建表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id        TEXT PRIMARY KEY,
        company_name  TEXT NOT NULL DEFAULT '',
        job_title     TEXT NOT NULL DEFAULT '',
        location      TEXT NOT NULL DEFAULT '',
        job_link      TEXT NOT NULL DEFAULT '',
        post_date     TEXT NOT NULL DEFAULT '',
        dead_line     TEXT NOT NULL DEFAULT '',
        job_type      TEXT NOT NULL DEFAULT '',
        description   TEXT NOT NULL DEFAULT '',
        salary        TEXT NOT NULL DEFAULT '',
        source        TEXT DEFAULT '',
        extracted_at  TEXT DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // 建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_name);
      CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
      CREATE INDEX IF NOT EXISTS idx_jobs_job_link ON jobs(job_link);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    `);

    console.log(`📦 数据库已初始化: ${this.dbPath}`);
  }

  /**
   * 检查 job 是否已存在
   */
  jobExists(jobId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM jobs WHERE job_id = ?').get(jobId);
    return !!row;
  }

  /**
   * 批量检查哪些 job_id 已存在，返回已存在的 ID 集合
   */
  getExistingJobIds(jobIds: string[]): Set<string> {
    if (jobIds.length === 0) return new Set();

    const placeholders = jobIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT job_id FROM jobs WHERE job_id IN (${placeholders})`)
      .all(...jobIds) as Array<{ job_id: string }>;

    return new Set(rows.map(r => r.job_id));
  }

  /**
   * 过滤出不在数据库中的新职位
   */
  filterNewJobs(jobs: JobData[]): { newJobs: JobData[]; skippedCount: number } {
    if (jobs.length === 0) return { newJobs: [], skippedCount: 0 };

    const existingIds = this.getExistingJobIds(jobs.map(j => j.job_id));
    const newJobs = jobs.filter(j => !existingIds.has(j.job_id));

    return {
      newJobs,
      skippedCount: jobs.length - newJobs.length,
    };
  }

  /**
   * 批量保存职位到数据库（INSERT OR IGNORE）
   * @returns 实际插入的行数
   */
  saveJobs(jobs: JobData[]): number {
    if (jobs.length === 0) return 0;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO jobs (
        job_id, company_name, job_title, location, job_link,
        post_date, dead_line, job_type, description, salary,
        source, extracted_at
      ) VALUES (
        @job_id, @company_name, @job_title, @location, @job_link,
        @post_date, @dead_line, @job_type, @description, @salary,
        @source, @extracted_at
      )
    `);

    let inserted = 0;

    const insertMany = this.db.transaction((jobs: JobData[]) => {
      for (const job of jobs) {
        const result = insert.run({
          job_id: job.job_id,
          company_name: job.company_name || '',
          job_title: job.job_title || '',
          location: job.location || '',
          job_link: job.job_link || '',
          post_date: job.post_date || '',
          dead_line: job.dead_line || '',
          job_type: job.job_type || '',
          description: job.description || '',
          salary: job.salary || '',
          source: job.source || '',
          extracted_at: job.extracted_at || new Date().toISOString(),
        });
        if (result.changes > 0) inserted++;
      }
    });

    insertMany(jobs);
    return inserted;
  }

  /**
   * 查询所有职位
   */
  getAllJobs(): JobData[] {
    return this.db
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC')
      .all() as JobData[];
  }

  /**
   * 获取职位总数
   */
  getJobCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM jobs')
      .get() as { count: number };
    return row.count;
  }

  /**
   * 按来源统计
   */
  getCountBySource(): Array<{ source: string; count: number }> {
    return this.db
      .prepare('SELECT source, COUNT(*) as count FROM jobs GROUP BY source ORDER BY count DESC')
      .all() as Array<{ source: string; count: number }>;
  }

  /**
   * 按条件查询职位
   */
  queryJobs(options: {
    source?: string;
    company?: string;
    keyword?: string;
    limit?: number;
  } = {}): JobData[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.source) {
      conditions.push('source LIKE ?');
      params.push(`%${options.source}%`);
    }
    if (options.company) {
      conditions.push('company_name LIKE ?');
      params.push(`%${options.company}%`);
    }
    if (options.keyword) {
      conditions.push('(job_title LIKE ? OR description LIKE ?)');
      params.push(`%${options.keyword}%`, `%${options.keyword}%`);
    }

    let sql = 'SELECT * FROM jobs';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as JobData[];
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
