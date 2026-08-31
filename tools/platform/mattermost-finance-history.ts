import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Client } from 'pg'

import type { FinanceHistorySnapshot, FinanceHistorySourceFile } from '@/lib/finance'

type MattermostPostRow = {
  id: string
  rootid: string
  createat: string | number
  message: string
}

type MattermostFileRow = {
  id: string
  postid: string
  name: string
  mimetype: string
  size: string | number
  path: string
}

function sourceFilePath(root: string, sourcePath: string): string {
  const absoluteRoot = path.resolve(root)
  const target = path.resolve(absoluteRoot, sourcePath)
  const relative = path.relative(absoluteRoot, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Mattermost file path escapes MATTERMOST_FILES_DIR: ${sourcePath}`)
  }
  return target
}

export async function readMattermostFileBytes(root: string, file: FinanceHistorySourceFile) {
  return readFile(sourceFilePath(root, file.sourcePath))
}

export async function loadMattermostFinanceHistory(input: {
  databaseUrl: string
  filesDir: string
  channel: string
}): Promise<FinanceHistorySnapshot> {
  if (input.databaseUrl.trim() === '') throw new Error('MATTERMOST_DATABASE_URL is required')
  if (input.filesDir.trim() === '') throw new Error('MATTERMOST_FILES_DIR is required')
  if (input.channel.trim() === '') throw new Error('Mattermost channel id/name is required')
  const client = new Client({ connectionString: input.databaseUrl })
  await client.connect()
  try {
    const channel = await client.query<{ id: string; displayname: string }>(
      `select id, displayname
         from channels
        where id = $1 or name = $1 or displayname = $1
        order by case when id = $1 then 0 when name = $1 then 1 else 2 end
        limit 1`,
      [input.channel],
    )
    const channelRow = channel.rows[0]
    if (channelRow === undefined) throw new Error(`Mattermost channel not found: ${input.channel}`)

    const postsResult = await client.query<MattermostPostRow>(
      `select id, rootid, createat, message
         from posts
        where channelid = $1 and deleteat = 0
        order by createat, id`,
      [channelRow.id],
    )
    const postIds = postsResult.rows.map((post) => post.id)
    const filesResult =
      postIds.length === 0
        ? { rows: [] as MattermostFileRow[] }
        : await client.query<MattermostFileRow>(
            `select id, postid, name, mimetype, size, path
               from fileinfo
              where postid = any($1::text[]) and deleteat = 0
              order by postid, id`,
            [postIds],
          )
    const files: FinanceHistorySourceFile[] = []
    for (const file of filesResult.rows) {
      const bytes = await readFile(sourceFilePath(input.filesDir, file.path))
      files.push({
        id: file.id,
        postId: file.postid,
        filename: file.name,
        mime: file.mimetype,
        size: Number(file.size),
        contentDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        sourcePath: file.path,
      })
    }
    const fileIdsByPost = new Map<string, string[]>()
    for (const file of files) {
      const ids = fileIdsByPost.get(file.postId) ?? []
      ids.push(file.id)
      fileIdsByPost.set(file.postId, ids)
    }
    return {
      version: 1,
      channel: { id: channelRow.id, name: channelRow.displayname },
      posts: postsResult.rows.map((post) => ({
        id: post.id,
        rootId: post.rootid === '' ? null : post.rootid,
        createdAt: new Date(Number(post.createat)).toISOString(),
        message: post.message,
        fileIds: (fileIdsByPost.get(post.id) ?? []).sort(),
      })),
      files,
    }
  } finally {
    await client.end()
  }
}
