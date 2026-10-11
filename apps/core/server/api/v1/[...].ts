import { apiProblem, sendProblem } from '../../lib/api/problem'

/** Toute autre route sous /api/v1 (identifiant déjà vérifié par le middleware) : 404 RFC 9457. */
export default defineEventHandler(event => sendProblem(event, apiProblem('NOT_FOUND', 'No such endpoint.')))
