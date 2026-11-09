"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerAdvisorQuestionAction } from "@/app/(app)/parts/advisor-ask-actions";
import { Button, Field, Textarea } from "@/components/ui";

/** The advisor's answer; it rings the asker's bell. The answer shows right here once sent. */
export function AnswerBox({ questionId, again }: { questionId: number; again: boolean }) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<{ error?: string; message?: string } | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const send = () =>
    start(async () => {
      try {
        const r = await answerAdvisorQuestionAction(questionId, text);
        setAnswer(r);
        if (r.ok) {
          setText("");
          router.refresh();
        }
      } catch {
        setAnswer({ error: "No connection – try again." });
      }
    });
  return (
    <div className="flex flex-col gap-2" data-ask-answer-box>
      <Field label={again ? "Add to the answer" : "Your answer"}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} data-ask-answer-text />
      </Field>
      {answer?.error ? <p className="text-sm font-bold text-red" data-ask-answer-error>{answer.error}</p> : null}
      {answer?.message ? <p className="text-sm font-bold text-green-text" data-ask-answer-sent>{answer.message}</p> : null}
      <div>
        <Button type="button" size="md" onClick={send} disabled={busy || !text.trim()} data-ask-answer-send>{busy ? "Sending…" : "Send the answer"}</Button>
      </div>
    </div>
  );
}
