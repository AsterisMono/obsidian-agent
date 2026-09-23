{ pkgs, ... }:

{
  packages = [ pkgs.git pkgs.obsidian pkgs.bubblewrap pkgs.lean4 ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  languages.python = {
    enable = true;
    package = pkgs.python3.withPackages (ps: [ ps.pyyaml ]);
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
