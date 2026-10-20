# FixForward AI

**The agent that gets things fixed.** FixForward AI coordinates appliance troubleshooting, warranty checks, repair cases, and appointment recovery in one persistent workflow.

This repository is being built incrementally for an Alexa+ hackathon submission. The current first step is the backend MCP server with simulated data.

## Current status

- [x] Step 1: Streamable HTTP MCP server and business logic
- [x] Persistent SQLite repair cases and appointment state
- [x] Explicit confirmation required before appointment booking
- [x] Demonstration scenario for technician cancellation and rescheduling
- [ ] Step 2: Browser-based conversational demo and repair dashboard
- [ ] Step 3: Agent orchestration and evidence-grounded responses
- [ ] Step 4: AWS service integration (for the AWS Builder mini challenge)
- [ ] Step 5: Deployment, end-to-end tests, and demo recording
- [ ] Step 6: Alexa+ onboarding/auth configuration if accessible

## Run the backend

See [`backend/README.md`](backend/README.md).

## Important demo limitation

Appliance, warranty, technician, and appointment records are simulated. The application does not contact a real repair company or book real-world services.

## License

MIT License — to be included in `LICENSE` before the public repository is submitted.
