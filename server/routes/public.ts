import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { district } from '../../shared/district';
import type { Merchant, SponsorshipPackage } from '../../shared/types';
import type { AppContext } from '../app';
import { notFound } from '../errors';
import { getMerchant, listCategories, listMerchants, listPackages, worldVersion } from '../repo';

/**
 * Featured directory slots: each package may feature at most `featured_limit`
 * merchants at once, earliest campaign first.
 */
export function featuredMerchantIds(merchants: Merchant[], packages: SponsorshipPackage[]): number[] {
  const out: number[] = [];
  for (const p of packages) {
    if (!p.benefits.featuredCard || p.featured_limit <= 0) continue;
    const holders = merchants
      .filter((m) => m.sponsorship?.package_id === p.id)
      .sort((a, b) => a.sponsorship!.starts_on.localeCompare(b.sponsorship!.starts_on) || a.id - b.id);
    out.push(...holders.slice(0, p.featured_limit).map((m) => m.id));
  }
  return out;
}

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/world/version', async () => ({ version: await worldVersion(db) }));

  app.get('/world', async () => {
    const [version, categories, merchants, packages] = await Promise.all([
      worldVersion(db),
      listCategories(db),
      listMerchants(db),
      listPackages(db, true),
    ]);
    return {
      version,
      district,
      categories,
      merchants,
      packages,
      featured_ids: featuredMerchantIds(merchants, packages),
    };
  });

  app.get('/merchants/:id', async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const m = await getMerchant(db, id, { activeOnly: true });
    if (!m) throw notFound('Merchant not found');
    return m;
  });

  app.get('/images/:id', async (req, reply) => {
    const parsed = z.object({ id: z.uuid() }).safeParse(req.params);
    if (!parsed.success) throw notFound('Image not found');
    const { rows } = await db.query('SELECT mime, bytes, sha256 FROM images WHERE id = $1', [parsed.data.id]);
    if (!rows[0]) throw notFound('Image not found');
    reply
      .header('Content-Type', rows[0].mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', `"${rows[0].sha256}"`)
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-origin');
    return reply.send(rows[0].bytes);
  });
}
