# Human direction and AI assistance

Arcloom is a human-directed project built with AI assistance. The project owner originated the connected-investigation idea, defined the report-to-review-to-follow-up workflow, set the product and design priorities, managed provider and database account setup, and reviewed the resulting interface, diagrams, video and article. Feedback drove revisions to graph readability, evidence presentation, the public demo and the submission materials.

AI coding assistants supported research, backend and frontend implementation, debugging, tests and documentation. They also helped translate the owner's requirements and review feedback into working code and presentation assets. The project should be assessed through its behavior, implementation and recorded verification. See [why we built Arcloom](docs/project-story.md) and the [validation record](docs/testing.md).

## Development and review

The owner supplied the concept and acceptance priorities, selected integrations and reviewed the product's presentation. Automated checks exercised policy, actual FalkorDB queries, HTTP lab behavior, fresh-process handoffs and browser flows. These automated results and human product review are distinct activities. Participants are responsible for understanding the code, explaining its decisions and accurately representing their own contributions.

## Runtime planning

Arcloom defaults to a labelled deterministic planner. Optional live providers receive bounded graph candidates and may propose a test or abstain. They cannot approve execution or accept evidence. Each operator supplies their own credentials or account consent; no development account is shipped with the project.

## Video and article

The owner directed and reviewed the story, requested the database and graph showcase, and reviewed revisions to the cut and narration. Claude and Codex assisted with the Remotion implementation, capture preparation, editing and technical checks. Narration uses ElevenLabs' premade Matilda voice; captions follow its character timestamps. No voice cloning was used. The [demo](docs/media/README.md) distinguishes recorded behavior, explanatory diagrams and separately validated live-provider runs.

The article was developed from the owner's concept, implementation and recorded evidence with drafting and editing assistance. Diagrams were drawn with code and application images came from the synthetic demonstration. The owner reviews and publishes the final submission. The repository's [license](LICENSE) governs its use.
