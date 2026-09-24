{ pkgs, lib, ... }:

let
  e2eFonts = with pkgs; [ dejavu_fonts noto-fonts noto-fonts-color-emoji noto-fonts-cjk-sans ];
in
{
  dotenv.enable = true;

  packages = with pkgs; [ git github-cli obsidian bubblewrap lean4 ];

  env = {
    OBSIDIAN_E2E_COMPOSITOR = "${pkgs.sway}/bin/sway";
    OBSIDIAN_E2E_FONTS = lib.concatMapStringsSep ":" (font: "${font}/share/fonts") e2eFonts;
  };

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
