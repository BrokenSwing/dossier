{
  description = "Dossier — self-hosted encrypted document vault";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Runtime
            nodejs_24
            pnpm

            # Native build deps (sharp, argon2, etc.)
            python3
            gnumake
            gcc
            pkg-config
            vips        # sharp links against libvips
          ];

          shellHook = ''
            echo "dossier dev shell"
            echo "node $(node --version)  pnpm $(pnpm --version)"
          '';
        };
      });
}
