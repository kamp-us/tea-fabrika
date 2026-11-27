// Two statuses of this repository's own, as GitHub listed them, recorded 2026-11-27 with
// `gh api --paginate --slurp repos/kamp-us/tea-fabrika/commits/<sha>/statuses`, in the lead's live proof of slice 1 of
// .kalfa/quests/review-record-PLAN.md: the one status of context `review` on a head a fresh record was written on, and the one on a head
// a carry was written on (the carry's status points at the same comment). Each is the one more array `--slurp` makes of its pages. The
// creator's account name, id and links are replaced with a made-up account of the same shape: this repository is public.

/** The statuses of the head a fresh record was written on. */
export const PASS =
  '[[{"url":"https://api.github.com/repos/kamp-us/tea-fabrika/statuses/b0338546456025f90eceaa6dc2c23924cbfd4d77","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4","id":60041815493,"node_id":"SC_kwDOU7rok88AAAAN-sVlxQ","state":"success","description":"pass v1 reviewed=b0338546456025f90eceaa6dc2c23924cbfd4d77 patch=40f4fdbce41630af530894b952128a258eb90f03","target_url":"https://github.com/kamp-us/tea-fabrika/pull/2357#issuecomment-7216807003","context":"review","created_at":"2026-11-27T11:12:33Z","updated_at":"2026-11-27T11:12:33Z","creator":{"login":"the-lead-login","id":1,"node_id":"MDQ6VXNlcjE=","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4","gravatar_id":"","url":"https://api.github.com/users/the-lead-login","html_url":"https://github.com/the-lead-login","type":"User","user_view_type":"public","site_admin":false}}]]';

/** The statuses of the head a carry was written on, over a merge of main. */
export const CARRY =
  '[[{"url":"https://api.github.com/repos/kamp-us/tea-fabrika/statuses/7a90299e0fe5946b15bedcf5ecfdf49e7c188c5d","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4","id":60041858668,"node_id":"SC_kwDOU7rok88AAAAN-sYObA","state":"success","description":"pass v1 reviewed=b0338546456025f90eceaa6dc2c23924cbfd4d77 patch=40f4fdbce41630af530894b952128a258eb90f03","target_url":"https://github.com/kamp-us/tea-fabrika/pull/2357#issuecomment-7216807003","context":"review","created_at":"2026-11-27T11:13:13Z","updated_at":"2026-11-27T11:13:13Z","creator":{"login":"the-lead-login","id":1,"node_id":"MDQ6VXNlcjE=","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4","gravatar_id":"","url":"https://api.github.com/users/the-lead-login","html_url":"https://github.com/the-lead-login","type":"User","user_view_type":"public","site_admin":false}}]]';
