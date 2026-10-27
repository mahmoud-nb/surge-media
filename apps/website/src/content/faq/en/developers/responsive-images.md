---
question: "How do I serve responsive images?"
order: 3
status: available
keywords: ["responsive","srcset","picture","avif","webp","focal point","crop"]
related:
  - label: "Image transformations"
    href: "/reference/image-transformations/"
---
Each media item returns a URL template, `urlTemplate`, that you fill in for every size and format:

```text
/m/k7d2m9qz/v3/w_800,h_450/sneaker.avif
/m/k7d2m9qz/v3/card/sneaker.webp
```

Crops are centered on the focal point chosen by your editors. The `SmPicture` component produces the AVIF and WebP sources, the `srcset` and the JPEG fallback.
