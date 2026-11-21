# An outside account is linked by authorizing our app on its site

To know which human is behind a GitHub account, such as someone who mentions the bot in a comment or a reviewer whose approval counts, the human authorizes our GitHub App (fabrikalfa) with GitHub's device flow, and Identity keeps the account's numeric id beside that human and drops the token at once. GitHub's own Slack app links accounts this way, the device flow needs no public post and no callback address, and a link never lets a key in (0022).

## Considered Options

- A signed note the human posts from the account, as Keybase did: rejected, because every human would leave a public post.
- A code the human comments to the bot from the account: rejected for GitHub, because it leaves a public trace and depends on reading comments. It stays an option for a site with no app sign-in.
