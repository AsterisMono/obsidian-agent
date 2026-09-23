{ pkgs, ... }:

{
  packages = [ pkgs.git pkgs.obsidian pkgs.bubblewrap ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };
}
