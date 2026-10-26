# Assessment Analytics

Choose Assessment Analytics when creating a team, or open Assessment Analytics from an existing team card. Existing student tracking remains available for existing teams. This mode presents aggregate results only.

## Upload workflow

1. Export every graded question from ZipGrade. Include quiz name, class when available, earned and possible totals, and per-question response, primary answer, grade mark, earned points and possible points. Student identity columns are unnecessary; if supplied, names, IDs and timestamps are discarded before persistence.
2. Select one or more CSV files. Label each preview with teacher, section, school year (for example 2026-2027), shared assessment name and version. Class values split an export automatically. If Class is blank, provide a section label or use Combined sections. Separate exports are required for separate section results when the original export does not label classes.
3. Use the same assessment name/version for the same test across teachers and years. Confirm matching question content/order for item comparisons; Reach also checks answer keys and relative point weights. Matching keys alone cannot prove identical content.
4. Review and save. Re-uploading the same assessment/version/year/teacher/section requires explicit replacement and does not add duplicate papers. Use consistent labels; differently labeled uploads count as separate cohorts.

## Reports

Overview includes paper count, mean, median, high/low, population standard deviation, proficiency at an adjustable threshold, score distribution and teacher/section summaries. Every paper has equal weight, so different section sizes do not distort the team average. Proportionally different scoring scales normalize to percentages.

Item analysis includes success rates, response distributions, discrimination and corrected item-total correlation (CITC). Item points normalize onto a common 100-point scale before pooled calculations. Undefined statistics display as unavailable.

Year over year compares two distinct school-year cohorts within one assessment/version, with sample sizes and percentage-point changes. It does not track individual student growth. Changed questions should use a different version; cross-version equating is not implemented. Historical exports must be uploaded to produce historical comparisons.

## Storage and permissions

Anonymous paper-level responses are stored in the team's existing Google Drive folder to support pooled item statistics. These are anonymous response records, not only precomputed aggregates. Team Drive permissions govern access. View-only/archived teams cannot upload. Each upload creates an immutable revision file; reports use the latest revision per section. Different teachers' files do not overwrite one another. Concurrent replacements of the same section resolve to the newest server timestamp, with file ID as tie-breaker. Refresh uploads to see others' changes. Incomplete reads fail visibly instead of reporting partial totals.

## Development

Edit `source/assessment-analytics.js`, then run `python3 tools/build-assessment-analytics.py` to embed it in `index.html`. Run `node --test tests/*.test.cjs`. Browser tests of the local preview use simulated storage; production Google Drive persistence requires a signed-in deployment acceptance test.
