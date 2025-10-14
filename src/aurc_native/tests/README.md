# aurc_native Tests

This folder will hold manifest parity tests ensuring the native compiler emits identical `.aurs` files as the Python MVP.

Planned workflow:
1. Add fixtures under `../fixtures/` (e.g., hello_world.aur/.aurs pairs).
2. Implement a small test runner that invokes `aurc-native` and diffs output against the fixture.
3. Integrate the runner into the Makefile `test` target.
