---
name: pr-monitor
description: Monitor the pull request, trigger and parse automated reviews from Gemini and Codex, analyze findings, apply surgical fixes with unit tests, and persist learnings to project memory.
risk: safe
---

# PR Monitor & Automated Review Skill

Use this skill to automate checking PR status, triggering reviews from AI assistants (Gemini, Codex), fixing identified issues, validating with tests, and writing learnings to project memory.

## Instructions

### Step 1: Check Active Background Tasks
Before triggering or fetching any external reviews, ensure that no test execution or code generation tasks are currently running in the background.
- Run `manage_task` with action `list` to check for active background tasks.
- If tasks are active, wait for their completion.

### Step 2: Fetch and Monitor PR Review Status
Use the GitHub CLI (`gh`) to check the status of the current pull request and reviews.
```bash
# Check current PR status and branch information
gh pr status

# Fetch the full JSON of all review comments and threads
gh api graphql -f query='
query {
  repository(owner: "diegosouzapw", name: "OmniRoute") {
    pullRequest(number: 3021) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 10) {
            nodes {
              id
              body
              author {
                login
              }
            }
          }
        }
      }
    }
  }
}'
```

### Step 3: Trigger Reviews from Assistants
If no tasks are running and no active/unresolved issues exist:
1. **Trigger/Check Gemini Review**: Ensure a recent `gemini-code-assist` review has run. If not, trigger it or wait for synchronization.
2. **Trigger Codex Review**: If Gemini review is clean and has no issues, trigger a Codex review by posting a comment on the PR:
   ```bash
   gh pr comment 3021 -b "@codex review"
   ```

### Step 4: Analyze Findings and Implement Fixes
For any unresolved threads or identified code issues:
1. **Analyze Root Cause**: Trace the issue to the exact source file and line.
2. **Apply Surgical Fixes**: Modify only the code necessary to solve the issue, matching the existing project style.
3. **Write Unit Tests**: Always add a corresponding test case in the appropriate test file (e.g., `tests/unit/*.test.ts`) to reproduce and verify the fix.
4. **Run Verification**: Ensure all tests compile and pass successfully.

### Step 5: Resolve GitHub Review Threads
Once a fix has been successfully verified, reply to the review comment and resolve the thread:
```bash
# Reply to a thread
gh api graphql -f query='
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
    clientMutationId
  }
}' -F threadId="<THREAD_ID>" -F body="Fixed. [Brief description of the fix]."

# Resolve the thread
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    clientMutationId
  }
}' -F threadId="<THREAD_ID>"
```

### Step 6: Persist Learnings to Memory
Add any new rules, constraints, regex behaviors, or code patterns discovered during the fix to the project's memory file:
- Append or update instructions in `CLAUDE.md` in the project root.
- Ensure the rules are clear, actionable, and state-driven.
