import { defineCollection, reference, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        date: z.coerce.date().optional(),
        lastmod: z.coerce.date().optional(),
        draft: z.boolean().optional(),
        summary: z.string().optional(),
        images: z.array(image()).optional(),
        authors: z.array(reference("authors")).optional(),
        tags: z.array(z.string()).optional(),
        postLayout: z.string().optional(),
        canonicalUrl: z.string().nullable().optional(),
      })
      .passthrough(),
});

const authors = defineCollection({
  type: "content",
  schema: ({ image }) =>
    z
      .object({
        name: z.string(),
        avatar: z.union([image(), z.string().url()]).optional(),
        occupation: z.string().optional(),
        company: z.string().optional(),
        email: z.string().email().optional(),
        twitter: z.string().url().optional(),
        linkedin: z.string().url().optional(),
        github: z.string().url().optional(),
        stackoverflow: z.string().url().optional(),
        url: z.string().url().optional(),
      })
      .passthrough(),
});

export const collections = {
  blog,
  authors,
};
