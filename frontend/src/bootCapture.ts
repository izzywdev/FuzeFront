// Side-effect module: MUST be the first import in main.tsx so the single-use
// token is lifted out of the URL before the first API call / telemetry init.
import { captureSingleUseParams } from './lib/singleUseParams'

captureSingleUseParams()
