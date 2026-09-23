{ pkgs, ... }:

{
  packages = [ pkgs.git pkgs.obsidian pkgs.bubblewrap ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  git-hooks.hooks = {
    eslint = {
      enable = true;
      settings = {
        binPath = "./node_modules/.bin/eslint";
        extensions = "\\.(ts|tsx|mts|cts)$";
      };
    };
    prettier = {
      enable = true;
      settings.binPath = "./node_modules/.bin/prettier";
    };
  };
}
