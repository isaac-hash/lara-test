import {
  dag,
  Container,
  Directory,
  object,
  func,
} from "@dagger.io/dagger";

@object()
export class HyliusPipeline {
  /**
   * Build a Docker image and push it to a container registry,
   * then notify the Hylius dashboard to trigger a VPS deployment.
   */
  @func()
  async buildAndPush(
    /** Source code directory */
    source: Directory,
    /** Registry hostname (e.g. ghcr.io) */
    registry: string,
    /** Full image name without tag (e.g. ghcr.io/owner/repo) */
    image: string,
    /** Image tag (e.g. git SHA) */
    tag: string,
    /** Hylius dashboard webhook URL */
    webhookUrl: string,
    /** Hylius API token */
    webhookToken: string,
    /** GitHub repo full name (e.g. owner/repo) */
    repo: string,
    /** Git commit SHA */
    sha: string,
    /** Git ref (e.g. refs/heads/main) */
    ref: string,
  ): Promise<string> {
    const imageFull = `${image.toLowerCase()}:${tag}`;

    // Build the image
    const built = await this.buildImage(source, imageFull);

    // Push to registry
    const digest = await built.publish(imageFull);

    // Notify Hylius dashboard to trigger VPS pull
    await this.notifyHylius({ webhookUrl, webhookToken, image: imageFull, sha, repo, ref });

    return `Published ${imageFull} @ ${digest}`;
  }

  /** Detect project type and build a Docker image. */
  private async buildImage(source: Directory): Promise<Container> {
    const entries = await source.entries();
  
    if (entries.includes("Dockerfile")) {
      return dag.container().build(source);
    }
  
    // No Dockerfile — use Railpack as a BuildKit frontend.
    // railpack prepare generates railpack-plan.json, then a synthetic
    // Dockerfile with #syntax tells BuildKit to use Railpack's frontend.
    const withPlan = await dag
      .container()
      .from("ghcr.io/railwayapp/railpack:latest")
      .withMountedDirectory("/app", source)
      .withExec(["railpack", "prepare", "/app", "--plan-out", "/app/railpack-plan.json"])
      .directory("/app");
  
    const withSyntheticDockerfile = withPlan.withNewFile(
      "Dockerfile",
      "# syntax=ghcr.io/railwayapp/railpack-frontend:latest\n# This file instructs BuildKit to use Railpack's frontend.\nFROM scratch\n"
    );

  return dag.container().build(withSyntheticDockerfile);
}

  /** Call the Hylius webhook to trigger a VPS deployment. */
  private async notifyHylius(opts: {
    webhookUrl: string;
    webhookToken: string;
    image: string;
    sha: string;
    repo: string;
    ref: string;
  }): Promise<void> {
    const payload = JSON.stringify({
      image: opts.image,
      sha: opts.sha,
      repo: opts.repo,
      ref: opts.ref,
    });

    await dag
      .container()
      .from("curlimages/curl:latest")
      .withExec([
        "curl", "-fsSL",
        "-X", "POST", opts.webhookUrl,
        "-H", "Content-Type: application/json",
        "-H", `Authorization: Bearer ${opts.webhookToken}`,
        "-d", payload,
      ])
      .sync();
  }
}
