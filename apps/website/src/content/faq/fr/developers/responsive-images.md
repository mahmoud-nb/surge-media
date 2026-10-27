---
question: "Comment servir des images responsives ?"
order: 3
status: available
keywords: ["responsive","srcset","picture","avif","webp","point d’intérêt","recadrage"]
related:
  - label: "Transformations d’images"
    href: "/reference/image-transformations/"
---
Chaque média renvoie un modèle d’URL, `urlTemplate`, que vous complétez pour chaque taille et chaque format :

```text
/m/k7d2m9qz/v3/w_800,h_450/chaussure.avif
/m/k7d2m9qz/v3/card/chaussure.webp
```

Les recadrages se centrent sur le point d’intérêt choisi par l’équipe éditoriale. Le composant `SmPicture` produit les sources AVIF et WebP, le `srcset` et le repli JPEG.
