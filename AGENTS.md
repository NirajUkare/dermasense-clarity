<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep skin-image assessment in a server function using the Lovable AI Gateway; this keeps the API key out of the browser.
- Generate PDF reports in the browser only after a physician reviews and confirms the draft; this prevents an unreviewed assessment from being presented as a diagnosis.
