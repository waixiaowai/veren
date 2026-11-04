import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/docs/design' }),
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      sidebar: z
        .object({
          order: z.number().optional(),
          label: z.string().optional(),
          hidden: z.boolean().optional(),
        })
        .optional(),
      draft: z.boolean().default(false),
      lastUpdated: z.coerce.date().optional(),
    }),
  }),
};
