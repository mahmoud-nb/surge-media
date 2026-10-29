/**
 * Messages de commit : Conventional Commits, source du CHANGELOG et du calcul de la version.
 * Vérifiés par le hook git commit-msg (simple-git-hooks, installé par `pnpm install`) et par la CI sur les
 * pull requests.
 *
 *   type(portée facultative): sujet      ex. feat(api): Add folder filters ; fix(d3): Detect HDR filters
 *   types : feat, fix, perf, build, docs, refactor, style, test, ci, chore, revert ; « ! » ou un pied
 *   « BREAKING CHANGE: » pour une rupture.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Casse du sujet libre (« feat: Add … » comme « feat: add … »).
    'subject-case': [0],
    // Lignes longues admises dans le corps et le pied (URL, co-auteurs).
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
}
