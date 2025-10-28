# Quick Commit

Create a commit with all current changes and push to the current branch.

## Steps
1. Show current git status
2. Ask user for commit message (if not provided)
3. Stage all changes: `git add .`
4. Commit with message
5. Push to current branch: `git push`
6. Show final status

## Usage
User says: "quick commit: fixed bug in parser"
OR: "quick commit" (then ask for message)

## Expected Output
- Files changed count
- Commit hash
- Push confirmation
