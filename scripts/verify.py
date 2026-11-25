#!/usr/bin/env python3
"""Thin entry point for the standalone verifier.

The verifier itself lives in the asiri-verify package
(packages/asiri-verify/src/asiri_verify/verify.py). This script
only finds that package inside a checkout and hands over, so
`python3 scripts/verify.py <tender>` keeps working with no
install. Installed users run `asiri-verify <tender>` instead.
"""

import os
import sys

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "packages",
        "asiri-verify",
        "src",
    ),
)

from asiri_verify.verify import main

if __name__ == "__main__":
    sys.exit(main())
