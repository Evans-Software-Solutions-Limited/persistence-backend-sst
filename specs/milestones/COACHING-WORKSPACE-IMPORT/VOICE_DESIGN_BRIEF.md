# Voice and conversation-to-programme — agent brief

Authority: spec 22 GD-1–4, design §10.6 and GD-T1–2; faithful dictation uses MI-1–8 instead. Both share the same review/accept service.

## Experience

Coach or Premium Plus athlete chooses either “Capture my plan” or “Help design a plan”. They type, dictate or provide an authorized transcript. Capture preserves the instructions; Design may propose missing programming only after goals/constraints are explicit. Coaches can save versioned methodology preferences. No athlete context is selected merely from a spoken name: show the authorized target and require deliberate choice.

A conversation might specify a six-week block, available days, target lifts and progression style, then amend week four. Show the resulting schedule and changed prescriptions, with unresolved questions and generated fields distinguished from source instructions. The user reviews, accepts to library, then separately schedules/assigns. Do not send an unfinished plan directly to clients.

## Work

Own speech-to-text adapter/evaluation and conversation-draft orchestration; backend import owner owns durable accept and source infrastructure. Frontend owns explicit recording controls, transcript correction, target/context selection and draft diff. No ambient meeting recorder. A multi-person recording needs the explicit recording acknowledgement and sensitive-source retention treatment in spec 22. Pasted transcript and OS dictation are useful inputs but must not be marketed as a fully integrated recording workflow.

Evaluate gym vocabulary, accents/noise, spoken corrections, repeated turns, missing units, unresolved target/previous-plan references, coaching-rule contradictions and hallucinated progressions. Compare to manual authoring, include transcription plus generation cost, and independently measure constraint violations. Use approved regional providers only after access/budget authorization. Preserve coach-private data boundaries in retrieval and prompts.

MCP/ChatGPT/Claude account connections are researched future distribution, not required for dictation. Do not create credentials/connectors or grant assistants broad live client write access. Return the reviewable prototype/contract, evaluation plan/results if actually run and implementation dependencies, with generation and capture gates distinguished.
