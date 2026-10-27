import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Actor, forbidden, HttpError, badRequest } from '../auth.js';

export interface UploadedFile { filename: string; mimetype: string; buffer: Buffer }
export async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; file: UploadedFile | null }> {
  const fields: Record<string, string> = {}; let file: UploadedFile | null = null;
  for await (const part of (req as any).parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.file.truncated) throw badRequest('Die Datei ist zu groß.');
      file = { filename: part.filename, mimetype: part.mimetype, buffer };
    } else fields[part.fieldname] = String(part.value ?? '');
  }
  return { fields, file };
}
export const needStaff = (a: Actor) => { if (a.role === 'kunde') throw forbidden('Dieser Bereich ist für Hersteller nicht freigegeben.'); };
export const sendFile = (reply: FastifyReply, name: string, buf: Buffer, type = 'application/octet-stream') =>
  reply.header('Content-Type', type).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).header('X-Content-Type-Options', 'nosniff').send(buf);
export { HttpError };
