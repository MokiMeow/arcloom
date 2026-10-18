# AI assistance disclosure

AI assistance was used to research implementation options, write and refine backend and frontend code, create tests and documentation, and investigate failures during development. This disclosure describes the use of assistance; it does not assign unverified contributions or review activities to individual participants.

Recorded validation includes Python tests, actual FalkorDB integration, a separate-process memory handoff, frontend compilation and browser automation. [Testing](docs/testing.md) distinguishes automated checks, live provider calls and the limits of those results. Synthetic vulnerabilities are intentional fixtures, not newly discovered weaknesses in a real organization.

At runtime, Arcloom defaults to a visibly labelled deterministic planner. Optional live providers receive bounded graph candidates and may propose a test or abstain. They cannot approve execution or accept evidence. A model response does not establish a vulnerability. Each operator supplies their own provider credentials or account consent; no development account or credential is shipped with the project.

Project participants remain responsible for understanding and reviewing the submitted work, accurately documenting their own contributions, protecting credentials and meeting the event's eligibility and disclosure requirements. The repository's existing [license](LICENSE) governs its use.

The demonstration video was also produced with AI assistance. A new Claude Code
session using Opus 5.5 at medium effort created the Remotion composition from a
prepared script and actual application captures. Codex completed the export and
verification. Narration is AI-generated speech from ElevenLabs (eleven_multilingual_v2,
premade voice "Matilda", owner's free-tier account); it is not a participant's
voice and no voice cloning was used. Captions are timed from ElevenLabs character
timestamps. An earlier cut used a local Windows synthetic voice. The edit labels actual
UI recordings, still captures, explanatory diagrams and excerpts of real CLI
output; it does not present animated diagrams as product behavior. The main
recording uses deterministic planning, with live model validation identified
separately. See the [demo assets](docs/media/README.md).

The [project article](docs/blog/README.md) was drafted in the
same Claude Opus session from the code, documentation and recorded execution
evidence. Codex edited the draft, checked its query and claims, corrected diagram
labels and assembled the DEV Markdown, images and local preview. The explanatory
graphics were drawn with code; application screenshots come from the synthetic
demonstration. Article preparation does not establish publication or submission.
