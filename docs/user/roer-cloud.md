# Move a thread to the cloud

With Roer linked, a thread can keep working on Roer's cloud worker while your laptop is closed, and
come back to this machine with everything it changed. Mate must run on the machine that hosts this
environment, and the thread's project needs a GitHub repository.

Link once in **Settings → Integrations → Roer** with your Roer URL and token. Then choose **Move to
cloud** from the thread's menu in the chat header or the sidebar, or from the command palette.

The thread's whole checkout goes along, including changes you have not committed, without changing
anything in your checkout here. A running turn continues in the cloud. While the thread is there,
the composer shows **Running in the cloud**; follow it in Roer or on your phone.

Choose **Bring back** in that notice, or **Bring back to this machine** from the menu. The cloud's
changes land in the same checkout: what it did not commit appears as uncommitted changes, its own
commits on your branch. If the checkout here changed after the move, the thread stays in the cloud,
so nothing is overwritten; fetch its branch yourself instead.

Files larger than 50 MB stay on this machine.
