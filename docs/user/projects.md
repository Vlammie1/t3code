# Projects

A project gathers work toward one goal. You give it a name, an icon, a goal and the folders,
repositories or files it works from. A coordinator thread plans the work, starts the chats that do
it and keeps track of them. You talk to the coordinator; the chats it starts are ordinary threads
in the project.

Open **Projects** from the sidebar or the command palette, or press `mod+alt+p` on web and desktop
when the terminal is not focused. Customize `projects.open` in **Settings → Keybindings**.

## Start a project

Choose **New project**, enter a name and optionally a goal, and add context: drop folders or files
into the dialog on desktop, choose a folder, or type a full path. T3 Code creates a folder for the
project and starts the coordinator, which replies with a plan for the goal. It starts chats once
you agree.

The coordinator runs on Claude Sonnet 5.5 with low effort, so following the work stays fast and
cheap. The chats it starts use the environment's default model unless it picks another one for the
task. Change the coordinator's model in its composer like any other thread.

Once a project has five chats, T3 Code pins the coordinator to the top of the sidebar. Unpin it
like any other thread and it stays unpinned.

When you come back to the coordinator after its provider's prompt cache has expired (an hour on a
Claude subscription), it continues in a fresh session that carries only its briefing and your last
exchange. That keeps a long coordinator conversation from being sent again in full. It reads
earlier messages and other chats again when it needs them.

## Change the goal or context

Open the project and select the goal to edit it, or use **+** in **Context**. T3 Code keeps the
goal and context in `AGENTS.md` in the project folder, which every chat in the project reads when
it starts. Notes you add to that file outside the project brief section stay.

Context paths live on the machine that runs the project. Chats reach them by their full path; they
do not get a checkout of their own. In a project chat, pick a context folder from the list at the
top of **Files** to read it there. The sidebar names the folder a chat works in when its title
mentions one, such as `Lockspace: paywall`; the coordinator titles its chats that way.
