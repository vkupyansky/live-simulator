import type { SemanticContext } from '@/features/ai/contracts';

export type ExplicitHostRequest = Extract<
  SemanticContext['hostIntent'],
  'request_questions' | 'request_topics'
>;

export interface HostUtteranceAnalysis {
  explicitRequest: ExplicitHostRequest | null;
  broadAudienceQuestion: boolean;
  resetsTopic: boolean;
  referencesCurrentFrame: boolean;
}

const TOPIC_REQUEST =
  /(?:предлож|посовет|подкин|назов|придум)\p{L}*.{0,28}(?:тем\p{L}*|иде\p{L}*)|(?:о\s*ч[её]м|на\s*какую\s*тему).{0,30}(?:поговор|пообщ)\p{L}*|(?:suggest|recommend|give|pick)\b.{0,24}\b(?:topic|idea)s?\b|what\s+should\s+we\s+(?:talk|chat)\s+about/iu;
const QUESTION_REQUEST =
  /(?:(?<!\p{L})(?:(?:по\s*)?зада(?:й|йте|вай|вайте)|напиш(?:и|ите)|пиш(?:и|ите))(?!\p{L}).{0,24}(?<!\p{L})вопрос\p{L}*|(?<!\p{L})(?:по\s*)?спроси(?:те)?(?!\p{L})|(?<!\p{L})(?:по\s*)?спрашива(?:й|йте)(?!\p{L})|(?<!\p{L})можете(?!\p{L}).{0,28}(?<!\p{L})спросить(?!\p{L})|ask\s+me.{0,20}questions?)/iu;
const TOPIC_RESET =
  /(?:(?<!\p{L})(?:сменим|сменить|смените|поменяем|поменять|поменяйте|изменим|изменить)(?!\p{L}).{0,18}(?<!\p{L})тем(?:у|ы|е|ой|а)?(?!\p{L})|(?<!\p{L})(?:перейд[её]м|перейти|перейдите|переключимся|переключиться)(?!\p{L}).{0,22}(?:(?<!\p{L})друг\p{L}*\s+тем\p{L}*|(?<!\p{L})тем\p{L}*)|(?<!\p{L})(?:давай|давайте|хочу|можем)(?!\p{L}).{0,32}(?:(?<!\p{L})друг\p{L}*\s+тем\p{L}*|(?:поговор|пообщ)\p{L}*.{0,24}(?:о|про).{0,18}друг\p{L}*)|(?:(?<!\p{L})о\s+ч[её]м(?:-нибудь|\s+нибудь|\s+то)?|(?<!\p{L})про\s+что(?:-нибудь|\s+нибудь|\s+то)?).{0,30}(?<!\p{L})друг\p{L}*.{0,24}(?:поговор|пообщ)\p{L}*|(?<!\p{L})(?:хватит\s+(?:об|про)\s+эт|(?:об|про)\s+эт\p{L}*\s+хватит|не\s+хочу\s+больше\s+(?:об|про)\s+эт)|\b(?:change|switch)\b.{0,18}\btopic\b|\b(?:talk|chat)\b.{0,20}\b(?:something\s+else|another\s+topic)\b|\benough\s+about\s+this\b)/iu;
const BROAD_AUDIENCE_QUESTION =
  /(?:чем\s+(?:вы|все)\s+.{0,24}(?:занимаетесь|заняты)|расскаж(?:и|ите|ете)(?!\p{L})|как\s+(?:у\s+вас|вы|дела)(?!\p{L})|кто\s+из\s+вас|кто\s+чем|что\s+(?:вы\s+)?думаете|что\s+посоветуете|меня\s+видно|видно\s+меня|откуда\s+вы)|(?:what\s+(?:do|are)\s+you\b|tell\s+me\b|how\s+are\s+you\b|who\s+(?:is\s+)?here\b|what\s+do\s+you\s+think\b|can\s+you\s+see\s+me\b|where\s+are\s+you\s+from\b)/iu;
const CURRENT_FRAME_REFERENCE =
  /(?:(?<!\p{L})что\s+эт(?:о|а)(?:\s+такое)?(?!\p{L})|(?<!\p{L})что\s+у\s+меня\s+(?:в|на)\s+рук\p{L}*|(?<!\p{L})(?:видите|видно|различаете|различимо|узнаёте|узнаете)(?!\p{L})|(?<!\p{L})я\s+(?:показываю|держу)(?!\p{L})|(?<!\p{L})(?:в\s+кадре|на\s+экране|перед\s+камерой)(?!\p{L})|(?<!\p{L})мож(?:ете|но)\s+(?:это\s+)?(?:увидеть|различить|узнать)(?!\p{L})|\bwhat(?:'s|\s+is)\s+this\b|\bwhat(?:'s|\s+is)\s+in\s+my\s+hand\b|\bcan\s+you\s+(?:see|tell|recognize)\b.{0,24}\b(?:showing|holding|this)\b)/iu;

function normalize(transcript: string): string {
  return transcript.normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/gu, ' ').trim();
}

export function analyzeHostUtterance(transcript: string): HostUtteranceAnalysis {
  const normalized = normalize(transcript);
  const resetsTopic = TOPIC_RESET.test(normalized);
  const explicitRequest: ExplicitHostRequest | null =
    resetsTopic || TOPIC_REQUEST.test(normalized)
      ? 'request_topics'
      : QUESTION_REQUEST.test(normalized)
        ? 'request_questions'
        : null;
  return {
    explicitRequest,
    broadAudienceQuestion: BROAD_AUDIENCE_QUESTION.test(normalized),
    resetsTopic,
    referencesCurrentFrame: CURRENT_FRAME_REFERENCE.test(normalized),
  };
}
