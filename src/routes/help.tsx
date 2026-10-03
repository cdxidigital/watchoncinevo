import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFrame } from "@/components/cinevo/public-frame";

export const Route = createFileRoute("/help")({ component: Help });

function Help() {
  return (
    <PublicFrame
      kicker="HELP"
      title="How the house works."
      lede="CINEVO only shows media you connect. There is no public catalog and no sample library."
    >
      <section className="rounded-xl border border-cine-border bg-cine-surface p-5">
        <h2>Start here</h2>
        <p>New to CINEVO? Follow the <Link to="/start">setup walkthrough</Link>, or read <Link to="/how-it-works">how the pieces fit together</Link> before you install anything.</p>
      </section>
      <section>
        <h2>Sign in</h2>
        <p>Use Google, X, or email and a password. After that, claim a username so friends can share a catalog with you.</p>
      </section>
      <section>
        <h2>Add a library</h2>
        <p>Open Library and pick one source at a time: a folder on this computer, Plex, Jellyfin, or CINEVO Node. Folder names stay in this browser. Plex and Jellyfin stay on the server you sign in to.</p>
      </section>
      <section>
        <h2>Watch</h2>
        <p>Playback starts with the original file, proxied through CINEVO. If the browser cannot play it, CINEVO asks your Plex or Jellyfin server for an H.264 copy. That conversion uses the hardware you turned on there. CINEVO itself does not transcode. Choose Grid, List, or Hybrid on Movies, TV, and Library, and sort by title, year, or when it was added.</p>
      </section>
      <section>
        <h2>On a TV</h2>
        <p>While a proxied title is playing, use the TV button. Android and Chrome offer Cast. Safari on iPhone, iPad, and Mac offers AirPlay. The TV opens that same stream, so the house has to be an address on your network, not localhost. A file that only exists in this browser cannot be sent.</p>
      </section>
      <section>
        <h2>Share</h2>
        <p>
          Sharing sends a catalog invite, not the files. Open <Link to="/app" search={{ core: "sharing" }}>Sharing</Link> after you sign in.
        </p>
      </section>
      <section>
        <h2>Node and the remote</h2>
        <p>
          <Link to="/node">Pair Node</Link> on the computer that holds the files. The phone remote controls titles already in this house.
        </p>
      </section>
    </PublicFrame>
  );
}
