# Reviewed npm release process

Check the registry version separately from this source. Do not approve an
older staged archive merely because its version matches.

1. Review exact source and required CI checks. Merge only with owner approval.
2. Run the workflow publish.yml with exact main SHA, stable version and
   submit_stage=false to prepare an inspected tarball without publishing.
3. Review the archive and release-receipt.json (source SHA, npm integrity,
   SHA-256, per-file hashes, successful installed CLI smoke tests).
4. Verify npm trusted publisher configuration for deepstriker88/format-inspector-lite,
   workflow filename publish.yml, stage-only permission, no direct publish
   or dist-tag permissions. Do not alter existing account settings blindly.
5. Check Staged Packages for existing versions. If an older stage has the same
   version, compare its integrity and resolve manually; never automatically
   reject or approve it. A staged version may block restaging.
6. Once explicitly authorized, run with submit_stage=true for the reviewed
   main SHA. The stage job verifies the archive hash and only stages it.
7. Review actual staged archive integrity and publisher; maintainer 2FA
   approval publishes it. Verify registry version, integrity, provenance and
   clean install afterward. Never report a placeholder as released.

Pinned official GitHub Actions and npm 12.2.3. No long-lived publish token
when trusted publishing is correctly configured. Actual account configuration
and 2FA require owner confirmation. The local prepare script never publishes.
Secret pattern scanning is limited, not a complete audit.

References: https://docs.npmjs.com/staged-publishing/ ;
https://docs.npmjs.com/trusted-publishers/ .
