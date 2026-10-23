/**
 * Interactive module — generic ask_user_question flow.
 *
 * Container-side `ask_user_question` writes a chat-sdk card to outbound.db +
 * polls inbound.db for a `question_response` system message. On the host side
 * this module handles the button-click response: look up the pending_questions
 * row, write the response into the session's inbound.db, wake the container.
 *
 * The `createPendingQuestion` call in `deliverMessage` (delivery.ts) stays
 * inline in core — it's 15 lines guarded by `hasTable('pending_questions')`,
 * modularizing it adds more registry surface than it saves.
 */
import { getDb, hasTable } from '../../db/connection.js';
import { deletePendingQuestion, getPendingQuestion, getSession } from '../../db/sessions.js';
import { requestWake } from '../../request-wake.js';
import { registerResponseHandler, type ResponseOutcome, type ResponsePayload } from '../../response-registry.js';
import { log } from '../../log.js';
import { writeSessionMessage } from '../../session-manager.js';

async function handleInteractiveResponse(payload: ResponsePayload): Promise<ResponseOutcome | false> {
  if (!(await hasTable(getDb(), 'pending_questions'))) return false;

  const pq = await getPendingQuestion(payload.questionId);
  if (!pq) return false;

  const session = await getSession(pq.session_id);
  if (!session) {
    log.warn('Session not found for pending question', { questionId: payload.questionId, sessionId: pq.session_id });
    await deletePendingQuestion(payload.questionId);
    return 'closed'; // ours, but the session that asked is gone
  }

  // Deleting the row claims the answer: of two answers, only one reaches the agent.
  if (!(await deletePendingQuestion(payload.questionId))) return 'ignored';
  try {
    await writeSessionMessage(session.agent_group_id, session.id, {
      id: `qr-${payload.questionId}-${Date.now()}`,
      kind: 'system',
      timestamp: new Date().toISOString(),
      platformId: pq.platform_id,
      channelType: pq.channel_type,
      threadId: pq.thread_id,
      content: JSON.stringify({
        type: 'question_response',
        questionId: payload.questionId,
        selectedOption: payload.value,
        userId: payload.userId ?? '',
      }),
    });
    // eslint-disable-next-line no-catch-all/no-catch-all -- logged; the question is closed either way
  } catch (err) {
    // The write may have half-committed, so the question isn't brought back for a
    // second answer: it is closed, and the lost answer logged.
    log.error('Question answer could not be written to the agent', { questionId: payload.questionId, err });
    return 'closed';
  }
  // Delivered: the card can show the answer while the agent wakes.
  payload.accepted?.();

  log.info('Question response routed', {
    questionId: payload.questionId,
    selectedOption: payload.value,
    sessionId: session.id,
  });

  await requestWake(session, 'interactive');
  return 'accepted';
}

registerResponseHandler(handleInteractiveResponse);
