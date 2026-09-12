import {createHash} from 'node:crypto';
import {SignJWT, jwtVerify} from 'jose';
import {buildAttempt, buildSlingerAttempt, KNOWLEDGE_BANK, QUESTIONS_PER_ATTEMPT} from '../domain/knowledge-bank';

export interface KnowledgeActor {tenantId: string; operatorId: string; audience?: 'OPERATOR' | 'ASSISTANT'}
const bankVersion = createHash('sha256').update(JSON.stringify(KNOWLEDGE_BANK)).digest('hex');
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is required for knowledge attempts');
  return new TextEncoder().encode(secret);
}
export async function createKnowledgeAttempt(actor: KnowledgeActor) {
  const questions = actor.audience === 'ASSISTANT' ? buildSlingerAttempt() : buildAttempt();
  const attemptToken = await new SignJWT({tenantId: actor.tenantId, audience: actor.audience ?? 'OPERATOR',
    questionIds: questions.map(q => q.id), bankVersion})
    .setProtectedHeader({alg: 'HS256'}).setIssuer('pilingtrack:knowledge')
    .setSubject(actor.operatorId).setIssuedAt().setExpirationTime('30m').sign(key());
  return {questions, attemptToken};
}
export async function verifyKnowledgeAttempt(actor: KnowledgeActor, attemptToken: string,
  picks: {questionId: string; picked: number}[]) {
  const {payload} = await jwtVerify(attemptToken, key(), {algorithms: ['HS256'], issuer: 'pilingtrack:knowledge', subject: actor.operatorId});
  const ids = payload.questionIds;
  if (payload.tenantId !== actor.tenantId || payload.audience !== (actor.audience ?? 'OPERATOR')
    || payload.bankVersion !== bankVersion || !Array.isArray(ids) || ids.length !== QUESTIONS_PER_ATTEMPT
    || picks.length !== ids.length || new Set(picks.map(p => p.questionId)).size !== ids.length
    || picks.some(p => !ids.includes(p.questionId))) {
    throw new Error('Attempt does not match the assigned questions');
  }
}
