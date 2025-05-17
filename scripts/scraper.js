(function() {
    console.log("scraper.js content script loaded.");

    function getClassName() {
        try {
            const breadcrumbsNav = document.querySelector('nav#breadcrumbs ul');
            if (breadcrumbsNav) {
                // Try a more specific selector first
                let courseNameElement = breadcrumbsNav.querySelector('li > a[href*="/courses/"][aria-current="page"] span.ellipsible, li > a[href*="/courses/"]:not([href*="/grades"]):not([href*="/assignments"]):not([href*="/pages"]):not([href*="/files"]):not([href*="/quizzes"]):not([href*="/modules"]):not([href*="/users"]) span.ellipsible');

                if (courseNameElement) {
                     let className = courseNameElement.textContent.trim();
                     if (className && className !== "Loading..." && className.length > 0 && !className.startsWith("Home") && className !== "Grades") {
                        console.log("Class name found (primary method):", className);
                        return className;
                    }
                }
                // Fallback: often the second non-home breadcrumb if the specific one fails
                const listItems = breadcrumbsNav.querySelectorAll('li > a > span.ellipsible');
                if (listItems.length > 1) {
                    // Iterate through list items, skipping the first (home)
                    for (let i = 1; i < listItems.length; i++) {
                        const potentialClassName = listItems[i].textContent.trim();
                        const parentAnchorHref = listItems[i].closest('a')?.getAttribute('href');
                        if (parentAnchorHref && parentAnchorHref.includes('/courses/') &&
                            !parentAnchorHref.endsWith('/grades') && // Ensure it's not the "Grades" link itself
                            !parentAnchorHref.endsWith('/') && // Often the direct course link ends with /courses/ID
                            potentialClassName.toLowerCase() !== "grades" && // Double check text content
                            potentialClassName.toLowerCase() !== "home" &&
                            potentialClassName.length > 0 && potentialClassName !== "Loading...") {
                            console.log("Class name found (fallback method):", potentialClassName);
                            return potentialClassName;
                        }
                    }
                }
            }
            console.warn("Could not reliably determine class name from breadcrumbs. Using 'Unknown Class'.");
            return "Unknown Class";
        } catch (error) {
            console.error("Error extracting class name:", error);
            return "Unknown Class";
        }
    }

    function extractStatValue(text, label) {
        if (!text) return null;
        const regex = new RegExp(label + ":\\s*(\\d+\\.?\\d*)", "i");
        const match = text.match(regex);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return null;
    }

    function parseScore(scoreText) {
        if (!scoreText) return null;
        const match = scoreText.match(/(\d+\.?\d*)/);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return null;
    }

    function scrapeGrades() {
        const gradesData = [];
        const assignments = document.querySelectorAll(
            '#grades_summary .student_assignment:not(.hard_coded):not(.group_total)'
        );

        if (!assignments || assignments.length === 0) {
            console.warn("No assignments found to scrape.");
            // Return empty array instead of undefined if you want to allow classes with no assignments but with weights
            return gradesData;
        }

        assignments.forEach(assignment => {
            try {
                const nameElement = assignment.querySelector('th.title a');
                const name = nameElement ? nameElement.textContent.trim() : 'No Name';

                const categoryElement = assignment.querySelector('th.title .context');
                const category = categoryElement ? categoryElement.textContent.trim() : 'Uncategorized';

                let score = null;
                const originalScoreElement = assignment.querySelector('.assignment_score .original_score');
                let originalScoreText = originalScoreElement ? originalScoreElement.textContent.trim() : null;
                
                score = parseScore(originalScoreText);

                if (score === null) {
                    const gradeElement = assignment.querySelector('.assignment_score .grade');
                    const gradeText = gradeElement ? gradeElement.textContent.trim() : null;
                    score = parseScore(gradeText);
                }
                
                const finalScrapedScore = score;

                const pointsPossibleElement = assignment.querySelector('.assignment_score .tooltip > span:last-of-type');
                const pointsPossibleText = pointsPossibleElement ? pointsPossibleElement.textContent.trim() : null;
                
                // default to 100 if no points possible text is found
                let pointsPossible = 100;
                if (pointsPossibleText) {
                    const pointsMatch = pointsPossibleText.match(/\/\s*(\d+\.?\d*)/);
                    if (pointsMatch && pointsMatch[1]) {
                        pointsPossible = parseFloat(pointsMatch[1]);
                    }
                }

                let detailsRow = assignment.nextElementSibling;
                 if (detailsRow && detailsRow.matches('tr[id^="final_grade_info_"]')) { // Skip the final_grade_info row if it exists
                    detailsRow = detailsRow.nextElementSibling;
                }


                let mean = null, median = null, high = null, low = null, upperQuartile = null, lowerQuartile = null;

                if (detailsRow && detailsRow.classList.contains('grade_details')) {
                    const statCells = detailsRow.querySelectorAll('.score_details_table tbody tr td');
                    if (statCells.length >= 3) {
                        const meanMedianText = statCells[0] ? statCells[0].textContent : '';
                        mean = extractStatValue(meanMedianText, "Mean");
                        median = extractStatValue(meanMedianText, "Median");

                        const highUpperText = statCells[1] ? statCells[1].textContent : '';
                        high = extractStatValue(highUpperText, "High");
                        upperQuartile = extractStatValue(highUpperText, "Upper Quartile");
                        
                        const lowLowerText = statCells[2] ? statCells[2].textContent : '';
                        low = extractStatValue(lowLowerText, "Low");
                        lowerQuartile = extractStatValue(lowLowerText, "Lower Quartile");
                    }
                }

                gradesData.push({
                    name: name,
                    category: category,
                    score: finalScrapedScore, 
                    pointsPossible: pointsPossible,
                    mean: mean,
                    median: median,
                    high: high,
                    low: low,
                    upperQuartile: upperQuartile,
                    lowerQuartile: lowerQuartile
                });
            } catch (error) {
                console.error("Error scraping a row:", error, "Assignment HTML:", assignment.innerHTML);
            }
        });
        return gradesData;
    }

    /**
     * Scrapes category weights if the summary table exists.
     * @returns {object|null} An object mapping category names to weights, or null.
     */
    function scrapeCategoryWeights() {
        const weightsTable = document.querySelector('table.summary'); // Selector for the weights table
        if (!weightsTable) {
            console.log("No category weights table (table.summary) found on this page.");
            return null;
        }

        const weights = {};
        const rows = weightsTable.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const thElement = row.querySelector('th[scope="row"]');
            const tdElement = row.querySelector('td');

            if (thElement && tdElement) {
                const categoryName = thElement.textContent.trim();
                const weightText = tdElement.textContent.trim();

                // Skip the "Total" row specifically
                if (categoryName.toLowerCase() === 'total') {
                    return; 
                }

                // Extract percentage value
                const weightMatch = weightText.match(/(\d+\.?\d*)\s*%/);
                if (weightMatch && weightMatch[1]) {
                    weights[categoryName] = parseFloat(weightMatch[1]);
                } else {
                    console.warn(`Could not parse weight for category "${categoryName}": ${weightText}`);
                }
            }
        });

        if (Object.keys(weights).length > 0) {
            console.log("Scraped category weights:", weights);
            return weights;
        }
        return null; // Return null if no weights were actually parsed
    }

    const className = getClassName();
    const grades = scrapeGrades();
    const categoryWeights = scrapeCategoryWeights();

    console.log(`Scraper: Data prepared for class "${className}"`);
    if (categoryWeights) {
        console.log("Scraper: Category weights found:", categoryWeights);
    }

    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        // Send data to background script to be held, not stored immediately
        chrome.runtime.sendMessage({
            action: "scrapedDataAvailable", // New action name
            className: className,
            data: grades,
            categoryWeights: categoryWeights // Will be null if not found
        });

        // Notify popup that processing/scraping part is done
        chrome.runtime.sendMessage({ action: "processingDone" });
    } else {
        console.log("chrome.runtime.sendMessage not available. Data logged above.");
    }
})();