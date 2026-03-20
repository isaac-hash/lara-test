import {
  dag,
  Container,
  Directory,
  Secret,
  object,
  func,
  argument,
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
  private async buildImage(source: Directory, imageTag: string): Promise<Container> {
    const entries = await source.entries();

    if (entries.includes("Dockerfile")) {
      // Native Docker build
      return dag.container().build(source);
    }

    // No Dockerfile — generate one with Railpack, then build
    const withDockerfile = await dag
      .container()
      .from("node:20-alpine")
      // Install Railpack
      .withExec(["sh", "-c", "curl -sSL https://railpack.com/install.sh | sh"])
      .withMountedDirectory("/app", source)
      .withWorkdir("/app")
      // Generate Dockerfile without needing a Docker daemon
      .withExec(["railpack", "generate"])
      .directory("/app");

    return dag.container().build(withDockerfile);
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
