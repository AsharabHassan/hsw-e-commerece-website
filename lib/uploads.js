// Product image uploads.
//
// Files land on the droplet's disk under public/uploads and are served by
// nginx. Filenames are generated, never taken from the client: a user-supplied
// name is an invitation to path traversal and to serving a .html file from
// your own origin.

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, unlink } from 'node:fs';

import multer from 'multer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
]);

export const MAX_BYTES = 5 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) ?? '';
    cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      // Reported to the operator rather than thrown, so the form can explain
      // itself instead of returning a 500.
      return cb(Object.assign(new Error('Only JPEG, PNG, WebP and AVIF images are accepted'), { status: 400 }));
    }
    cb(null, true);
  },
});

/** Middleware accepting a single file under the field name `image`. */
export const singleImage = upload.single('image');

/** Delete an uploaded file. Failure is logged, never fatal. */
export function removeUpload(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/')) return;

  const filename = path.basename(publicPath);
  unlink(path.join(UPLOAD_DIR, filename), (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn(`Could not delete upload ${filename}:`, err.message);
    }
  });
}

/** The public URL for a stored file. */
export function publicPathFor(file) {
  return `/uploads/${path.basename(file.filename)}`;
}
