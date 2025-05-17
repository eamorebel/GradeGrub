document.addEventListener('DOMContentLoaded', () => {
    const classSelector = document.getElementById('class-selector');
    const gradesOutput = document.getElementById('grades-output');
    const deleteClassButton = document.getElementById('delete-class-button');
    const overallGradeContainer = document.getElementById('overall-grade-container');
    const overallGradeDisplay = document.getElementById('overall-grade-display');
    const unweightedTotalDisplay = document.getElementById('unweighted-total-display');

    let currentClassData = null;
    let globalAllClassesData = {};
    let currentClassNameForDisplay = null;

    const DEFAULT_GRADE_CUTOFFS = {
        'A+': 97,
        'A': 94,
        'A-': 90,
        'B+': 87,
        'B': 84,
        'B-': 80,
        'C+': 77,
        'C': 74,
        'C-': 70,
        'D+': 67,
        'D': 64,
        'D-': 60,
        'F': 0
    };

    const gradeCutoffManagerDiv = document.getElementById('grade-cutoff-manager');
    const cutoffInputsContainer = document.getElementById('cutoff-inputs-container');
    const saveCutoffsButton = document.getElementById('save-cutoffs-button');
    const resetCutoffsButton = document.getElementById('reset-cutoffs-button');

    const whatIfCalculatorDiv = document.getElementById('what-if-calculator');
    const whatIfAssignmentSelector = document.getElementById('what-if-assignment-selector');
    const extraCreditInput_whatIf = document.getElementById('extra-credit-percentage_what-if'); 
    const calculateNeededForCutoffsButton = document.getElementById('calculate-needed-for-cutoffs-button');
    const whatIfResultsDisplay = document.getElementById('what-if-results-display');

    let currentClassCutoffs = { ...DEFAULT_GRADE_CUTOFFS };

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    const debouncedSaveAllClassesData = debounce(() => {
        chrome.storage.local.set({ 'allClassesData': globalAllClassesData }, () => {
            //console.log('All classes data saved to storage via debounce. Data:', globalAllClassesData);
        });
    }, 1000);

    function calculateCategoryTotal(categoryName, calculationMethod) {
        if (!currentClassData || !Array.isArray(currentClassData)) {
            return { totalScore: 0, totalPossible: 0, percentage: 0, methodUsed: calculationMethod, hasGradedItems: false, droppedCount: 0, droppedAssignmentOriginalIndices: new Set() };
        }

        // Ensure each assignment has its originalIndex from currentClassData for reliable identification
        const assignmentsWithContext = currentClassData.map((asm, index) => ({
            ...asm,
            originalIndex: index // This is the key index we need to track
        }));

        // 1. Filter for the current category AND !isExcluded
        let assignmentsForCategory = assignmentsWithContext.filter(
            assignment => (assignment.category || 'Uncategorized') === categoryName && !assignment.isExcluded
        );

        // 2. Apply automatic drops
        const classSettings = globalAllClassesData[currentClassNameForDisplay + '_settings'] || {};
        const numDropsForCategory = parseInt(classSettings.categoryDrops?.[categoryName], 10) || 0;
        let actualDroppedCount = 0;
        let droppedAssignmentOriginalIndices = new Set(); // Initialize here

        if (numDropsForCategory > 0 && assignmentsForCategory.length > 0) {
            // Identify assignments eligible for dropping (must have a score and valid positive points possible)
            const gradableAssignments = assignmentsForCategory
                .filter(asm => {
                    const score = parseFloat(asm.score);
                    const possible = parseFloat(asm.pointsPossible);
                    return !isNaN(score) && !isNaN(possible) && possible > 0;
                });

            if (gradableAssignments.length > numDropsForCategory) {
                // Sort by percentage score (score / possible) ascending to find the lowest
                gradableAssignments.sort((a, b) => {
                    const percA = (parseFloat(a.score) / parseFloat(a.pointsPossible));
                    const percB = (parseFloat(b.score) / parseFloat(b.pointsPossible));
                    return percA - percB;
                });

                // Identify the assignments to drop
                const assignmentsToActuallyDrop = gradableAssignments.slice(0, numDropsForCategory);
                actualDroppedCount = assignmentsToActuallyDrop.length;
                
                // Store the original indices of the assignments that are actually dropped
                assignmentsToActuallyDrop.forEach(asm => droppedAssignmentOriginalIndices.add(asm.originalIndex));

                // Filter out the dropped assignments from the list used for calculation
                assignmentsForCategory = assignmentsForCategory.filter(asm => {
                    // If it's one of the dropped ones (identified by originalIndex), exclude from calculation
                    return !droppedAssignmentOriginalIndices.has(asm.originalIndex);
                });
            } else if (gradableAssignments.length > 0) { // All gradable assignments are dropped
                actualDroppedCount = gradableAssignments.length;
                gradableAssignments.forEach(asm => droppedAssignmentOriginalIndices.add(asm.originalIndex));
                
                assignmentsForCategory = assignmentsForCategory.filter(asm => {
                    // Keep only non-gradable if all gradable are dropped (or rather, filter out those that were dropped)
                    return !droppedAssignmentOriginalIndices.has(asm.originalIndex);
                });
            }
        }


        // 3. Calculate totals with the remaining assignments
        let totalScore = 0, totalPossible = 0, validAssignmentsCount = 0, hasGradedItems = false;

        if (calculationMethod === 'equalWeight') {
            let sumOfIndividualPercentages = 0;
            assignmentsForCategory.forEach(asm => {
                const score = parseFloat(asm.score);
                const possible = parseFloat(asm.pointsPossible);
                if (!isNaN(score) && !isNaN(possible) && possible > 0) {
                    sumOfIndividualPercentages += (score / possible);
                    validAssignmentsCount++;
                    hasGradedItems = true;
                } else if (asm.score !== null && asm.score !== undefined) { // Has a score but maybe no points possible (e.g. extra credit)
                     hasGradedItems = true; // Still counts as a graded item for the category activity
                }
            });
            totalScore = sumOfIndividualPercentages;
            totalPossible = validAssignmentsCount; // Denominator is count of items
        } else { // totalPoints
            assignmentsForCategory.forEach(asm => {
                const score = parseFloat(asm.score);
                const possible = parseFloat(asm.pointsPossible);
                if (!isNaN(score)) {
                    totalScore += score;
                    hasGradedItems = true;
                }
                if (!isNaN(possible) && possible > 0) { // Only add to totalPossible if it's a positive number
                    totalPossible += possible;
                    if (asm.score === null || asm.score === undefined) hasGradedItems = true; // Ungraded but has points possible
                } else if (!isNaN(score) && (isNaN(possible) || possible === 0)) { // Score but no valid points possible
                    hasGradedItems = true;
                }
            });
        }

        let percentage = 0;
        if (totalPossible > 0) {
            percentage = (calculationMethod === 'equalWeight' ? totalScore / totalPossible : totalScore / totalPossible) * 100;
        } else if (hasGradedItems && totalPossible === 0 && calculationMethod === 'totalPoints') {
             // e.g. category has only extra credit items with scores but no points possible, or all points possible are 0
             // In this specific case for total points, if totalPossible is 0 but there are scores, the percentage is effectively infinite or undefined.
             // We might want to display totalScore as "bonus" or handle this as 100% if totalScore > 0, or 0%.
             // For now, if totalPossible is 0, percentage is 0 unless specific handling is added.
             if (totalScore > 0) percentage = 100; // Or some other representation. This is a common way to handle pure bonus.
             else percentage = 0;
        } else if (calculationMethod === 'equalWeight' && validAssignmentsCount === 0 && hasGradedItems) {
            percentage = 0;
        }

        //console.log(`[${categoryName}] Final droppedAssignmentOriginalIndices before return:`, new Set(droppedAssignmentOriginalIndices)); // DEBUG (log a copy)
        return {
            totalScore,
            totalPossible,
            percentage: isNaN(percentage) ? 0 : percentage,
            methodUsed: calculationMethod,
            hasGradedItems,
            droppedCount: actualDroppedCount,
            droppedAssignmentOriginalIndices
        };
    }

    function calculateOverallFinalGrade() {
        if (!currentClassNameForDisplay || !globalAllClassesData[currentClassNameForDisplay]) {
            return { finalGrade: null, totalWeightApplied: 0, unweightedAverage: 0, warnings: ["No class data." ] };
        }

        const classAssignments = globalAllClassesData[currentClassNameForDisplay];
        const classWeights = globalAllClassesData[currentClassNameForDisplay + '_weights'] || {};
        const classSettings = globalAllClassesData[currentClassNameForDisplay + '_settings']?.categoryCalcMethods || {};

        let weightedScoreSum = 0;
        let totalWeightApplied = 0;
        let includedCategoriesCount = 0;
        let sumOfCategoryPercentagesForUnweighted = 0;
        let unweightedCategoriesCount = 0;
        const warnings = [];

        const allCategoryNames = new Set();
        if (classAssignments) {
            classAssignments.forEach(a => allCategoryNames.add(a.category || 'Uncategorized'));
        }
        Object.keys(classWeights).forEach(cat => allCategoryNames.add(cat));
        if (classSettings.categoryDrops) Object.keys(classSettings.categoryDrops).forEach(cat => allCategoryNames.add(cat));

        allCategoryNames.forEach(categoryName => {
            const weight = parseFloat(classWeights[categoryName]);
            const calcMethod = classSettings[categoryName] || 'totalPoints';
            const categoryStats = calculateCategoryTotal(categoryName, calcMethod);

            // For unweighted average, include category if it has graded items or assignments
             if (categoryStats.hasGradedItems || (currentClassData && currentClassData.some(a => (a.category || 'Uncategorized') === categoryName))) {
                sumOfCategoryPercentagesForUnweighted += categoryStats.percentage;
                unweightedCategoriesCount++;
            }

            if (!isNaN(weight) && weight > 0) {
                if (categoryStats.hasGradedItems) { // Only include in weighted if category has graded items
                    weightedScoreSum += categoryStats.percentage * (weight / 100);
                    totalWeightApplied += (weight / 100);
                    includedCategoriesCount++;
                } else {
                    // Category has weight but no graded items. Consider if this weight should still be part of totalWeightApplied
                    // For now, if a category has a weight but no graded items, it doesn't contribute to the numerator,
                    // but its weight IS part of the denominator if we want the grade to reflect missing work in weighted categories.
                    // Alternative: only add to totalWeightApplied if categoryStats.hasGradedItems is true.
                    // Current approach: if a category is weighted, its weight counts towards the total expected weight.
                    // If it has no graded items, its contribution is 0, effectively lowering the overall grade.
                    // This seems reasonable.
                     totalWeightApplied += (weight / 100); // Add weight even if no graded items, so "empty" weighted categories pull down the average
                }
            } else if (!isNaN(weight) && weight === 0) {
                // Category explicitly set to 0 weight, ignore for weighted calculation.
            } else if (isNaN(weight) && categoryStats.hasGradedItems) {
                // Category has grades but no weight assigned.
                warnings.push(`Category "${categoryName}" has grades but no weight assigned.`);
            }
        });

        let finalGrade = null;
        if (totalWeightApplied > 0) {
            finalGrade = (weightedScoreSum / totalWeightApplied); // This is already a percentage
        } else if (includedCategoriesCount > 0 && totalWeightApplied === 0) {
            // Has graded categories, but none of them are weighted (or all weights are 0)
            warnings.push("Grades exist, but no weights are applied to categories with grades. Cannot calculate weighted grade.");
        } else if (Object.keys(classWeights).length > 0 && totalWeightApplied === 0 && includedCategoriesCount === 0) {
            // Weights are defined, but the categories they apply to have no graded items yet.
            // The final grade effectively would be 0 if we consider the weights.
            finalGrade = 0; // Or null, depending on desired behavior for "empty but weighted" courses.
            warnings.push("Categories are weighted, but no graded assignments exist in them yet.");
        }


        const unweightedAverage = unweightedCategoriesCount > 0 ? sumOfCategoryPercentagesForUnweighted / unweightedCategoriesCount : 0;

        if (totalWeightApplied * 100 > 100) {
            warnings.push(`Total assigned weight (${(totalWeightApplied * 100).toFixed(1)}%) exceeds 100%.`);
        } else if (totalWeightApplied * 100 < 100 && totalWeightApplied > 0) {
            warnings.push(`Total assigned weight is ${(totalWeightApplied * 100).toFixed(1)}%. Final grade is based on this sum.`);
        }


        return {
            finalGrade: finalGrade,
            totalWeightApplied: totalWeightApplied * 100, // as percentage
            unweightedAverage: unweightedAverage,
            warnings: warnings
        };
    }

    function updateOverallGradeDisplay() {
        if (!currentClassNameForDisplay) {
            if (overallGradeContainer) overallGradeContainer.style.display = 'none';
            if (overallGradeDisplay) overallGradeDisplay.textContent = 'Select a class and ensure weights are set.';
            if (unweightedTotalDisplay) unweightedTotalDisplay.textContent = '';
            //console.log("No class selected for overall grade display.");
            return;
        }

        const gradeData = calculateOverallFinalGrade();
        //console.log("Overall grade data:", gradeData);

        if (overallGradeContainer) overallGradeContainer.style.display = 'block';

        if (overallGradeDisplay) {
            if (gradeData.finalGrade !== null) {
                overallGradeDisplay.textContent = `Estimated Weighted Grade: ${gradeData.finalGrade.toFixed(2)}%`;
            } else if (gradeData.warnings.includes("No class data.")) {
                 overallGradeDisplay.textContent = 'Select a class to calculate grade.';
            }
            else {
                overallGradeDisplay.textContent = 'Weighted Grade: N/A (Check weights or add grades)';
            }
        }

        if (unweightedTotalDisplay) {
            let unweightedText = `Unweighted Average of Category Percentages: ${gradeData.unweightedAverage.toFixed(2)}%. `;
            unweightedText += `Total Weight Applied: ${gradeData.totalWeightApplied.toFixed(1)}%.`;
            if (gradeData.warnings.length > 0 && !gradeData.warnings.includes("No class data.")) {
                unweightedText += ` \nWarnings: ${gradeData.warnings.join('; ')}`;
            }
            unweightedTotalDisplay.textContent = unweightedText;
            unweightedTotalDisplay.style.whiteSpace = 'pre-line'; // Allow line breaks for warnings
        }
    }

    function updateCategoryDisplay(categoryName) {
        const escapedCategoryName = CSS.escape(categoryName);
        const categoryGroupDiv = document.querySelector(`.grade-group[data-category-name="${escapedCategoryName}"]`);
        if (!categoryGroupDiv) {
            console.warn(`UpdateDisplay: Could not find category group div for: ${categoryName}`);
            return;
        }
        const methodSelector = categoryGroupDiv.querySelector('.category-calc-method');
        const selectedMethod = methodSelector ? methodSelector.value : 'totalPoints';
        const result = calculateCategoryTotal(categoryName, selectedMethod); // Recalculates with drops/exclusions

        // console.log(`%c[${categoryName}] In updateCategoryDisplay - AFTER calculateCategoryTotal call:`, "color: blue; font-weight: bold;");
        // if (result) {
        //     console.log(`[${categoryName}] Full 'result' object:`, result); // Log the whole object
            
        //     // Check for the specific property and its type
        //     if (result.hasOwnProperty('droppedAssignmentOriginalIndices')) {
        //         console.log(`[${categoryName}] 'droppedAssignmentOriginalIndices' IS an own property of result.`);
        //         console.log(`[${categoryName}] Value of result.droppedAssignmentOriginalIndices:`, result.droppedAssignmentOriginalIndices);
        //         if (result.droppedAssignmentOriginalIndices instanceof Set) {
        //             console.log(`[${categoryName}] result.droppedAssignmentOriginalIndices IS a Set. Size: ${result.droppedAssignmentOriginalIndices.size}. Values: ${JSON.stringify([...result.droppedAssignmentOriginalIndices])}`);
        //         } else {
        //             console.warn(`%c[${categoryName}] result.droppedAssignmentOriginalIndices is NOT a Set. Type: ${typeof result.droppedAssignmentOriginalIndices}`, "color: orange;");
        //         }
        //     } else {
        //         console.error(`%c[${categoryName}] CRITICAL: 'result' object DOES NOT HAVE 'droppedAssignmentOriginalIndices' property.`, "color: red; font-weight: bold;");
        //         console.log(`[${categoryName}] Keys found in 'result' object:`, Object.keys(result));
        //     }
        // } else {
        //     console.error(`%c[${categoryName}] CRITICAL: 'result' from calculateCategoryTotal is undefined or null!`, "color: red; font-weight: bold;");
        // }

        const totalDisplay = categoryGroupDiv.querySelector('.category-total-display');

        if (totalDisplay) {
            let displayFormat = result.methodUsed === 'equalWeight' ?
                `Category Average: ${result.percentage.toFixed(2)}% (from ${result.totalPossible} assignments)` :
                `Category Total: ${result.totalScore.toFixed(2)} / ${result.totalPossible.toFixed(2)} (${result.percentage.toFixed(2)}%)`;
            if (result.droppedCount > 0) {
                displayFormat += ` (${result.droppedCount} dropped)`;
            }
            totalDisplay.textContent = displayFormat;
            if (!result.hasGradedItems && result.droppedCount === 0) { // only show if no other info
                 totalDisplay.textContent += " (No graded items)";
            }
        }

        if (categoryGroupDiv) {
            const assignmentElements = categoryGroupDiv.querySelectorAll('.assignment');
            const result = calculateCategoryTotal(categoryName, methodSelector ? methodSelector.value : 'totalPoints'); // Recalculate to get fresh droppedAssignmentOriginalIndices

            assignmentElements.forEach(asmEl => {
                const originalIndex = parseInt(asmEl.dataset.assignmentOriginalIndex, 10);
                if (isNaN(originalIndex) || !currentClassData || !currentClassData[originalIndex]) return;

                const assignmentData = currentClassData[originalIndex];
                const isManuallyExcluded = assignmentData.isExcluded;
                // Check if this assignment's originalIndex is in the set of automatically dropped ones
                const isAutomaticallyDropped = result.droppedAssignmentOriginalIndices && result.droppedAssignmentOriginalIndices.has(originalIndex);

                // Remove all potentially conflicting classes first to ensure clean state
                asmEl.classList.remove('excluded-assignment', 'dropped-assignment');

                if (isAutomaticallyDropped) {
                    asmEl.classList.add('dropped-assignment');
                } else if (isManuallyExcluded) { 
                    // Only apply excluded if not dropped. Dropped status takes precedence for styling and calculation.
                    asmEl.classList.add('excluded-assignment');
                }
                // If neither, it has no special styling class.

                // Ensure the manual exclude icon is also correct (it might have been set during initial render)
                // This logic should remain as it controls the manual exclusion toggle, independent of automatic drops.
                const excludeIcon = asmEl.querySelector('.toggle-exclude-assignment-icon');
                if (excludeIcon) {
                    if (isManuallyExcluded) {
                        excludeIcon.innerHTML = '&#128064;'; // Closed eye
                        excludeIcon.title = "Include Assignment";
                    } else {
                        excludeIcon.innerHTML = '&#128065;'; // Open eye
                        excludeIcon.title = "Exclude Assignment";
                    }
                }
            });
        }

        updateOverallGradeDisplay();
    }

    function displayGradesForClass(className, allClassesData) {
        currentClassNameForDisplay = className;
        globalAllClassesData = allClassesData;
        currentClassData = globalAllClassesData[className] || [];
        const classSettingsKey = className + '_settings';
        if (!globalAllClassesData[classSettingsKey]) {
            globalAllClassesData[classSettingsKey] = { categoryCalcMethods: {}, categoryDrops: {}, gradeCutoffs: {...DEFAULT_GRADE_CUTOFFS} };
            //console.log(`No settings found for ${className}. Created default settings.`);
        } else {
            if (!globalAllClassesData[classSettingsKey].gradeCutoffs || Object.keys(globalAllClassesData[classSettingsKey].gradeCutoffs).length === 0) {
                 globalAllClassesData[classSettingsKey].gradeCutoffs = { ...DEFAULT_GRADE_CUTOFFS };
                 //console.log(`Grade cutoffs missing or empty for ${className}, applying defaults.`);
            }
        }

        currentClassCutoffs = { ...globalAllClassesData[classSettingsKey].gradeCutoffs };

        const classSettings = globalAllClassesData[classSettingsKey];
        if (!classSettings.categoryCalcMethods) classSettings.categoryCalcMethods = {};
        if (!classSettings.categoryDrops) classSettings.categoryDrops = {}; // Initialize drops

        console.log(`[GradeGrub]: Displaying grades for ${className}:`, currentClassData);
        gradesOutput.innerHTML = '';

        if (className && currentClassData) {
            deleteClassButton.style.display = 'inline-block';
            if (overallGradeContainer) overallGradeContainer.style.display = 'block';
            let outputHTML = '';

            const assignmentCategories = currentClassData.map(a => a.category || 'Uncategorized');
            const weightsKey = className + '_weights';
            const weightCategories = globalAllClassesData[weightsKey] ? Object.keys(globalAllClassesData[weightsKey]) : [];
            const settingsCategories = classSettings.categoryCalcMethods ? Object.keys(classSettings.categoryCalcMethods) : [];
            const dropCategories = classSettings.categoryDrops ? Object.keys(classSettings.categoryDrops) : [];

            const allKnownCategoriesSet = new Set([...assignmentCategories, ...weightCategories, ...settingsCategories, ...dropCategories]);
            const categories = Array.from(allKnownCategoriesSet).sort();


            categories.forEach(categoryName => {
                if (!categoryName) return;
                const categoryIdSafeForHtmlId = categoryName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
                const categoryCalculationMethod = classSettings.categoryCalcMethods[categoryName] || 'totalPoints';
                const numDrops = classSettings.categoryDrops[categoryName] || 0;

                const deleteIconUnicode = '&#128465;'; // Trash can icon

                outputHTML += `<div class="grade-group" data-category-name="${categoryName}">`;
                outputHTML += `  <h3>${categoryName}</h3>`;
                outputHTML += `  <div class="category-header">`;
                outputHTML += `    <label for="category-weight-${categoryIdSafeForHtmlId}">Weight: </label>`;
                outputHTML += `    <input type="number" class="category-weight-input" id="category-weight-${categoryIdSafeForHtmlId}" data-category="${categoryName}" placeholder="e.g., 20" step="any" min="0"> %`;
                outputHTML += `    <label for="category-drops-${categoryIdSafeForHtmlId}" style="margin-left: 10px;">Drop Lowest: </label>`;
                outputHTML += `    <input type="number" class="category-drops-input" id="category-drops-${categoryIdSafeForHtmlId}" data-category="${categoryName}" value="${numDrops}" min="0" max="20" style="width: 50px;">`; // Added drops input
                outputHTML += `    <span class="calculation-method-selector">Calculation: <select class="category-calc-method" data-category="${categoryName}">`;
                outputHTML += `        <option value="totalPoints" ${categoryCalculationMethod === 'totalPoints' ? 'selected' : ''}>Total Points</option>`;
                outputHTML += `        <option value="equalWeight" ${categoryCalculationMethod === 'equalWeight' ? 'selected' : ''}>Equal Weight</option>`;
                outputHTML += `      </select></span>`;
                outputHTML += `    <strong class="category-total-display">Calculating...</strong>`;
                outputHTML += `    <span class="delete-category-icon delete-icon" data-category="${categoryName}" title="Delete Category ${categoryName}">${deleteIconUnicode}</span>`;
                outputHTML += `  </div><div class="category-content">`;

                const assignmentsInCategory = currentClassData
                    .map((assignment, originalIndex) => ({ ...assignment, originalIndex }))
                    .filter(a => (a.category || 'Uncategorized') === categoryName)
                    .sort((a,b) => a.name.localeCompare(b.name));

                assignmentsInCategory.forEach(assignment => {
                    const scoreValue = assignment.score ?? '';
                    const pointsPossibleValue = assignment.pointsPossible ?? '';
                    const isExcluded = assignment.isExcluded || false;
                    const assignmentDivClass = isExcluded ? "assignment excluded-assignment" : "assignment";
                    const excludeIconUnicode = isExcluded ? '&#128064;' : '&#128065;'; // Closed eye / Open eye
                    const excludeTitle = isExcluded ? "Include Assignment" : "Exclude Assignment";

                    // originalIndex is used for data binding
                    outputHTML += `<div class="${assignmentDivClass}" id="assignment-${assignment.originalIndex}" data-assignment-original-index="${assignment.originalIndex}">`;
                    outputHTML += `  <span class="assignment-name">${assignment.name}:</span> `;
                    outputHTML += `  <input type="number" class="editable-grade assignment-score-input" value="${scoreValue}" data-assignment-index="${assignment.originalIndex}" data-property="score" placeholder="Score" step="any"> / `;
                    outputHTML += `  <input type="number" class="editable-grade assignment-points-input" value="${pointsPossibleValue}" data-assignment-index="${assignment.originalIndex}" data-property="pointsPossible" placeholder="Total" step="any" min="0">`;
                    // Add exclude icon and delete icon
                    outputHTML += `  <span class="toggle-exclude-assignment-icon toggle-icon" data-assignment-index="${assignment.originalIndex}" title="${excludeTitle}">${excludeIconUnicode}</span>`; // Exclude icon
                    outputHTML += `  <span class="delete-assignment-icon delete-icon" title="Delete Assignment ${assignment.name}">${deleteIconUnicode}</span>`;
                    // Add assignment stats
                    outputHTML += `  <div class="assignment-stats">`;
                    if (assignment.mean !== null) outputHTML += `<span>Mean: ${assignment.mean}</span>`;
                    if (assignment.low !== null && assignment.high !== null && assignment.lowerQuartile !== null && assignment.median !== null && assignment.upperQuartile !== null) {
                         outputHTML += `<span>Min: ${assignment.low}</span><span>Q1: ${assignment.lowerQuartile}</span><span>Med: ${assignment.median}</span><span>Q3: ${assignment.upperQuartile}</span><span>Max: ${assignment.high}</span>`;
                    }
                    outputHTML += `</div></div>`; // Close assignment-stats and assignment
                });

                // Inline form for adding new assignment (initially hidden)
                const formId = `add-assignment-form-${categoryIdSafeForHtmlId}`;
                outputHTML += `<div id="${formId}" class="add-item-form add-assignment-form" style="display:none; margin-top:10px; padding:10px; border:1px solid #e0e0e0; background-color:#f9f9f9;">`;
                outputHTML += `    <h5 style="margin-top:0;">Add New Assignment to ${categoryName}</h5>`;
                outputHTML += `    <label for="new-assignment-name-${categoryIdSafeForHtmlId}" style="display:block; margin-bottom:3px;">Name:</label>`;
                outputHTML += `    <input type="text" id="new-assignment-name-${categoryIdSafeForHtmlId}" placeholder="Assignment Name" style="width:95%; margin-bottom:8px; padding:5px;">`;
                outputHTML += `    <label for="new-assignment-score-${categoryIdSafeForHtmlId}" style="display:block; margin-bottom:3px;">Score:</label>`;
                outputHTML += `    <input type="number" id="new-assignment-score-${categoryIdSafeForHtmlId}" placeholder="e.g., 85" step="any" style="width:95%; margin-bottom:8px; padding:5px;">`;
                outputHTML += `    <label for="new-assignment-points-${categoryIdSafeForHtmlId}" style="display:block; margin-bottom:3px;">Points Possible:</label>`;
                outputHTML += `    <input type="number" id="new-assignment-points-${categoryIdSafeForHtmlId}" placeholder="e.g., 100" step="any" style="width:95%; margin-bottom:8px; padding:5px;">`;
                outputHTML += `    <button class="confirm-add-assignment action-button" data-category="${categoryName}" data-form-id="${formId}">Add This Assignment</button>`;
                outputHTML += `    <button class="cancel-add-item action-button secondary-button" data-form-id="${formId}">Cancel</button>`;
                outputHTML += `</div>`;
                // Button to show the form
                outputHTML += `<button class="show-add-assignment-form action-button" data-category="${categoryName}" data-form-id="${formId}">+ Add Assignment to ${categoryName}</button>`;
                

                outputHTML += `</div></div>`; // Close category-content and grade-group
            });
            
            // Container for adding a new category
            outputHTML += `<div class="add-new-category-container" style="margin-top: 20px; padding:10px; border-top: 1px solid #eee;">
                               <h4>Manage Categories</h4>
                               <button id="show-add-category-form" class="action-button">+ Add New Category</button>
                               <div id="add-category-form" style="display:none; margin-top:10px; padding:10px; border:1px solid #ddd; background-color: #f9f9f9;">
                                   <label for="new-category-name" style="display:block; margin-bottom:5px;">New Category Name:</label>
                                   <input type="text" id="new-category-name" placeholder="e.g., Projects" style="margin-bottom:10px; width: calc(100% - 22px); padding: 8px;">
                                   <button id="confirm-add-category" class="action-button">Add Category</button>
                                   <button id="cancel-add-category" class="action-button secondary-button">Cancel</button>
                               </div>
                           </div>`;

            gradesOutput.innerHTML = outputHTML;
            attachInputListeners(className, classSettingsKey);
            loadCategoryWeights(className); // For weights
            loadCategorySettings(className);  // For drops
            categories.forEach(categoryName => {
                if (categoryName) updateCategoryDisplay(categoryName);
            });
            updateOverallGradeDisplay();

            if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'block';
            if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'block';

            //console.log("[displayGradesForClass] About to render cutoff inputs and populate what-if selector.");
            renderGradeCutoffInputs();
            populateWhatIfAssignmentSelector();

        } else {
            currentClassNameForDisplay = null;
            deleteClassButton.style.display = 'none';
            gradesOutput.innerHTML = className ? 
                `<p>No grades data available for ${className}. Try scraping this class's grades page again.</p>` : 
                '<p>Please select a class to view its grades.</p>';
            updateOverallGradeDisplay(); // Clear overall grade display

            if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'none';
            if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'none';
        }
    }

    function handleAddAssignmentFromForm(currentClassName, categoryName, formElement) {
        const categoryIdSafe = categoryName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        const nameInput = formElement.querySelector(`#new-assignment-name-${categoryIdSafe}`);
        const scoreInput = formElement.querySelector(`#new-assignment-score-${categoryIdSafe}`);
        const pointsInput = formElement.querySelector(`#new-assignment-points-${categoryIdSafe}`);

        const assignmentName = nameInput ? nameInput.value.trim() : "";
        if (!assignmentName) {
            alert("Please enter a name for the new assignment.");
            nameInput?.focus();
            return;
        }

        const scoreStr = scoreInput ? scoreInput.value.trim() : "";
        const pointsPossibleStr = pointsInput ? pointsInput.value.trim() : "";

        const newAssignment = {
            name: assignmentName,
            category: categoryName,
            score: scoreStr !== "" ? parseFloat(scoreStr) : null,
            pointsPossible: pointsPossibleStr !== "" ? parseFloat(pointsPossibleStr) : null,
            mean: null, median: null, high: null, low: null, upperQuartile: null, lowerQuartile: null,
            isExcluded: false // Initialize new assignments as not excluded
        };

        if ((newAssignment.score !== null && isNaN(newAssignment.score)) ||
            (newAssignment.pointsPossible !== null && (isNaN(newAssignment.pointsPossible) || (newAssignment.pointsPossible < 0)))) {
            alert("Invalid score or points possible. Points possible must be a non-negative number or blank.");
            return;
        }
        
        if (!globalAllClassesData[currentClassName]) {
            globalAllClassesData[currentClassName] = [];
        }
        globalAllClassesData[currentClassName].push(newAssignment);
        currentClassData = globalAllClassesData[currentClassName];

        debouncedSaveAllClassesData();
        //console.log("New assignment added via form, re-displaying class.");
        displayGradesForClass(currentClassName, globalAllClassesData); // Re-render
    }

    function handleAddCategory(currentClassName, newCategoryName) {
        if (!currentClassName || !globalAllClassesData[currentClassName]) {
            alert("No class selected or class data not found."); return;
        }
        const currentAssignments = globalAllClassesData[currentClassName];
        const existingCategoriesLC = [...new Set(currentAssignments.map(a => (a.category || 'Uncategorized').toLowerCase()))];
        
        const weightsKey = currentClassName + '_weights';
        if(globalAllClassesData[weightsKey]) {
            Object.keys(globalAllClassesData[weightsKey]).forEach(cat => existingCategoriesLC.push(cat.toLowerCase()));
        }
        const settingsKey = currentClassName + '_settings';
        if(globalAllClassesData[settingsKey] && globalAllClassesData[settingsKey].categoryCalcMethods) {
             Object.keys(globalAllClassesData[settingsKey].categoryCalcMethods).forEach(cat => existingCategoriesLC.push(cat.toLowerCase()));
        }


        if ([...new Set(existingCategoriesLC)].includes(newCategoryName.toLowerCase())) {
            alert(`Category "${newCategoryName}" already exists or is a reserved name.`); return;
        }

        // Initialize weights and settings for the new category
        if (!globalAllClassesData[weightsKey]) globalAllClassesData[weightsKey] = {};
        globalAllClassesData[weightsKey][newCategoryName] = 0; // Default weight

        if (!globalAllClassesData[settingsKey]) globalAllClassesData[settingsKey] = { categoryCalcMethods: {} };
        else if (!globalAllClassesData[settingsKey].categoryCalcMethods) globalAllClassesData[settingsKey].categoryCalcMethods = {};
        globalAllClassesData[settingsKey].categoryCalcMethods[newCategoryName] = 'totalPoints';
        
        debouncedSaveAllClassesData();
        //console.log(`Category "${newCategoryName}" prepared. Re-displaying class.`);
        displayGradesForClass(currentClassName, globalAllClassesData); // Re-render
    }

    /**
     * Handles deleting a specific assignment.
     * @param {string} currentClassName - The name of the current class.
     * @param {number} assignmentOriginalIndex - The original index of the assignment in currentClassData.
     */
    function handleDeleteAssignment(currentClassName, assignmentOriginalIndex) {
        if (!currentClassData || assignmentOriginalIndex < 0 || assignmentOriginalIndex >= currentClassData.length) {
            console.error("Invalid assignment index or no current class data for deletion.");
            return;
        }
        const assignmentToDelete = currentClassData[assignmentOriginalIndex];
        if (!assignmentToDelete) {
            console.error("Assignment not found at index:", assignmentOriginalIndex);
            return;
        }

        if (confirm(`Are you sure you want to delete the assignment "${assignmentToDelete.name}"?`)) {
            const categoryOfDeletedAssignment = assignmentToDelete.category || 'Uncategorized';
            
            // Remove the assignment from currentClassData (which is globalAllClassesData[currentClassName])
            currentClassData.splice(assignmentOriginalIndex, 1);
            // Note: assignmentOriginalIndex is the index in the *original* currentClassData.
            // If currentClassData was re-filtered/re-sorted for display before this, direct splice might be wrong.
            // It's safer to filter by a unique ID if possible, or re-filter based on the object.
            // However, since displayGradesForClass re-renders from the full currentClassData,
            // and we're using originalIndex from that full array, splice should be correct here.

            debouncedSaveAllClassesData();
            //console.log(`Assignment "${assignmentToDelete.name}" deleted.`);
            
            // Re-render to reflect changes and update totals.
            // Or, for better performance, just remove the DOM element and update its category total.
            // For simplicity with current structure, full re-render:
            displayGradesForClass(currentClassName, globalAllClassesData);
            // If you only re-render a category, make sure the category's total is updated.
            // updateCategoryDisplay(categoryOfDeletedAssignment);
        }
    }

    /**
     * Handles deleting an entire category and all its assignments.
     * @param {string} currentClassName - The name of the current class.
     * @param {string} categoryName - The name of the category to delete.
     */
    function handleDeleteCategory(currentClassName, categoryName) {
        if (!currentClassData) {
            console.error("No current class data for category deletion.");
            return;
        }

        if (confirm(`Are you sure you want to delete the category "${categoryName}" and all its assignments? This cannot be undone.`)) {
            // Filter out assignments belonging to this category
            globalAllClassesData[currentClassName] = currentClassData.filter(
                assignment => (assignment.category || 'Uncategorized') !== categoryName
            );
            currentClassData = globalAllClassesData[currentClassName]; // Update local reference

            // Remove category from weights
            const weightsKey = currentClassName + '_weights';
            if (globalAllClassesData[weightsKey] && globalAllClassesData[weightsKey].hasOwnProperty(categoryName)) {
                delete globalAllClassesData[weightsKey][categoryName];
            }

            // Remove category from settings
            const settingsKey = currentClassName + '_settings';
            if (globalAllClassesData[settingsKey]?.categoryCalcMethods?.hasOwnProperty(categoryName)) {
                delete globalAllClassesData[settingsKey].categoryCalcMethods[categoryName];
            }

            debouncedSaveAllClassesData();
            //console.log(`Category "${categoryName}" and its assignments deleted.`);
            
            // Re-render the entire class display
            displayGradesForClass(currentClassName, globalAllClassesData);
        }
    }

    
    function renderGradeCutoffInputs() {
        // Log the state of currentClassCutoffs at the beginning of this function
        //console.log('[renderGradeCutoffInputs] Called. Current cutoffs to render:', JSON.parse(JSON.stringify(currentClassCutoffs)));

        if (!cutoffInputsContainer) {
            console.error("[renderGradeCutoffInputs] Error: cutoffInputsContainer element not found in DOM.");
            return;
        }
        //console.log(cutoffInputsContainer.innerHTML); //check internals
        cutoffInputsContainer.innerHTML = ''; // Clear previous inputs to prevent duplication

        // Check if currentClassCutoffs has any keys. If not, it might indicate an issue upstream.
        if (Object.keys(currentClassCutoffs).length === 0) {
            console.warn("[renderGradeCutoffInputs] currentClassCutoffs is empty. This might be an error. Inputs will be empty.");
            // Optionally, you could force it to defaults here if that's desired behavior for an empty object,
            // but ideally, it should be populated correctly before this function is called.
            // currentClassCutoffs = { ...DEFAULT_GRADE_CUTOFFS }; // Fallback, but investigate why it's empty
        }

        Object.entries(currentClassCutoffs)
            .sort(([, valA], [, valB]) => parseFloat(valB) - parseFloat(valA)) // Sort by percentage descending
            .forEach(([grade, percentage]) => {
                const div = document.createElement('div');
                div.style.marginBottom = '5px';

                const label = document.createElement('label');
                label.htmlFor = `cutoff-${grade}`;
                label.textContent = `${grade}: `;
                label.style.display = 'inline-block';
                label.style.width = '50px';

                const input = document.createElement('input');
                input.type = 'number';
                input.id = `cutoff-${grade}`;

                const numPercentage = parseFloat(percentage);
                //console.log(`[renderGradeCutoffInputs] Processing grade ${grade} with percentage: ${percentage} (parsed as ${numPercentage})`);
                if (!isNaN(numPercentage)) {
                    const valueStr = numPercentage.toFixed(2);
                    //console.log(`[renderGradeCutoffInputs] Setting input value for ${grade} to: ${valueStr}`);
                    input.value = valueStr; // This sets the property that the input displays
                } else {
                    input.value = '';
                    console.warn(`[renderGradeCutoffInputs] Invalid percentage for grade ${grade}: ${percentage}`);
                }

                input.min = "0";
                input.max = "200";
                input.step = "0.01";
                input.dataset.grade = grade;
                input.style.width = '70px';
                input.addEventListener('change', handleCutoffInputChange);

                // Create the text node for " %"
                const percentTextNode = document.createTextNode(' %');

                // Append children in order
                div.appendChild(label);
                div.appendChild(input);
                div.appendChild(percentTextNode); // Append the text node last

                cutoffInputsContainer.appendChild(div);
            });
        //console.log('[renderGradeCutoffInputs] Finished rendering cutoff inputs.');
    }

    function handleCutoffInputChange(event) {
        const grade = event.target.dataset.grade;
        let value = parseFloat(event.target.value);
        if (isNaN(value) || value < 0) value = 0;
        if (value > 200) value = 200; // Arbitrary upper limit for sanity
        currentClassCutoffs[grade] = value;
        event.target.value = value; // Update input field with sanitized value
        // No automatic save, user must click "Save Custom Cutoffs"
        //console.log('[handleCutoffInputChange] Cutoffs updated in memory:', currentClassCutoffs);
    }

    function saveCustomCutoffs() {
        if (!currentClassNameForDisplay) return;
        //console.log('[saveCustomCutoffs] Saving cutoffs:', currentClassCutoffs);
        const classSettingsKey = currentClassNameForDisplay + '_settings';
        if (!globalAllClassesData[classSettingsKey]) {
            globalAllClassesData[classSettingsKey] = { categoryCalcMethods: {}, categoryDrops: {}, gradeCutoffs: {...DEFAULT_GRADE_CUTOFFS}};
            //console.log(`[displayGradesForClass] Grade cutoffs missing or empty for ${className}, applying defaults.`);
        }
        globalAllClassesData[classSettingsKey].gradeCutoffs = { ...currentClassCutoffs };
        debouncedSaveAllClassesData();
        alert('Custom grade cutoffs saved!');
        renderGradeCutoffInputs(); // Re-render to ensure sorted order if values changed significantly
    }

    function populateWhatIfAssignmentSelector() {
        //console.log('[populateWhatIfAssignmentSelector] Called.');
        if (!whatIfAssignmentSelector || !currentClassData) {
            console.warn("[populateWhatIfAssignmentSelector] Selector or currentClassData not available.");
            if(whatIfAssignmentSelector) whatIfAssignmentSelector.innerHTML = '<option value="">--No Class Data--</option>';
            return;
        }
        whatIfAssignmentSelector.innerHTML = '<option value="">--Select an Assignment--</option>';
        calculateNeededForCutoffsButton.disabled = true;
        whatIfResultsDisplay.innerHTML = '';

        currentClassData.forEach((asm, index) => {
            if (!asm.isExcluded) { // Only include non-manually-excluded assignments
                const option = document.createElement('option');
                option.value = index; // Use originalIndex
                let assignmentLabel = `${asm.name} (Category: ${asm.category || 'Uncategorized'})`;
                if (asm.score !== null && asm.score !== undefined && asm.pointsPossible !== null && asm.pointsPossible !== undefined) {
                    assignmentLabel += ` - Current: ${asm.score}/${asm.pointsPossible}`;
                } else if (asm.pointsPossible !== null && asm.pointsPossible !== undefined) {
                    assignmentLabel += ` - Total: ${asm.pointsPossible}`;
                } else {
                    assignmentLabel += ` - (No points info)`;
                }
                option.textContent = assignmentLabel;
                whatIfAssignmentSelector.appendChild(option);
            }
        });

        whatIfAssignmentSelector.onchange = () => {
            calculateNeededForCutoffsButton.disabled = !whatIfAssignmentSelector.value;
            whatIfResultsDisplay.innerHTML = ''; // Clear previous results on new selection
            //console.log('[populateWhatIfAssignmentSelector] What-if assignment selected, index:', whatIfAssignmentSelector.value);
        };
        //console.log('[populateWhatIfAssignmentSelector] Finished populating selector.');
    }

    function resetDefaultCutoffs() {
        if (!currentClassNameForDisplay) return;
        //console.log('[resetDefaultCutoffs] Resetting to defaults.');
        if (confirm("Are you sure you want to reset cutoffs to their default values?")) {
            currentClassCutoffs = { ...DEFAULT_GRADE_CUTOFFS };
            // Also save this reset to storage
            const classSettingsKey = currentClassNameForDisplay + '_settings';
            if (!globalAllClassesData[classSettingsKey]) {
                globalAllClassesData[classSettingsKey] = { categoryCalcMethods: {}, categoryDrops: {}, gradeCutoffs: {} };
            }
            globalAllClassesData[classSettingsKey].gradeCutoffs = { ...DEFAULT_GRADE_CUTOFFS };
            debouncedSaveAllClassesData();
            renderGradeCutoffInputs();
            alert('Grade cutoffs reset to default.');
        }
    }

    /**
     * Calculates the minimum score needed on a target assignment to achieve a desired overall final grade.
     * @param {number} targetAssignmentOriginalIndex - The original index of the assignment in currentClassData.
     * @param {number} desiredOverallGrade - The target final grade percentage (e.g., 94 for an A).
     * @param {number} extraCreditPercent - The percentage of extra credit to consider (e.g., 25 for 25% extra).
     * @returns {object} An object { neededScore: number | null, pointsPossible: number, isPossible: boolean, finalGradeAchieved: number | null }
     * neededScore is null if not possible or assignment invalid.
     */
    function calculateMinScoreForAssignment(targetAssignmentOriginalIndex, desiredOverallGrade, extraCreditPercent) {
        //console.log(`[calculateMinScoreForAssignment] Index: ${targetAssignmentOriginalIndex}, Desired Overall: ${desiredOverallGrade}%`);
        if (!currentClassData || targetAssignmentOriginalIndex < 0 || targetAssignmentOriginalIndex >= currentClassData.length) {
            console.error("[calculateMinScoreForAssignment] Invalid target assignment index or no class data.");
            return { neededScore: null, pointsPossible: null, isPossible: false, finalGradeAchieved: null };
        }

        const targetAssignment = currentClassData[targetAssignmentOriginalIndex];
        const originalScore = targetAssignment.score; // Save original score
        // Ensure pointsPossible is a number, default to a value that would make calculations safe if it's invalid
        const pointsPossible = parseFloat(targetAssignment.pointsPossible);

        if (isNaN(pointsPossible) || pointsPossible <= 0) {
            console.warn(`[calculateMinScoreForAssignment] Target assignment "${targetAssignment.name}" has invalid points possible (${targetAssignment.pointsPossible}). Cannot calculate.`);
            targetAssignment.score = originalScore; // Restore original score
            return { neededScore: null, pointsPossible: targetAssignment.pointsPossible, isPossible: false, finalGradeAchieved: null };
        }

        let minNeededScore = null;
        let finalGradeWithMinNeededScore = null;
        const multiplier = 1 + (parseFloat(extraCreditPercent) / 100);
        const maxTestScore = pointsPossible * multiplier; // Test up to 125% (for extra credit)
        const step = Math.max(0.01, pointsPossible / 2000); // Dynamic step for precision, min 0.01

        //console.log(`[calculateMinScoreForAssignment] Iterating scores for "${targetAssignment.name}" (0 to ${maxTestScore.toFixed(2)}) with step ${step.toFixed(4)}`);

        for (let testScore = 0; testScore <= maxTestScore; testScore += step) {
            const currentTestScore = parseFloat(testScore.toFixed(4)); // Use higher precision for testScore
            currentClassData[targetAssignmentOriginalIndex].score = currentTestScore;

            const calculatedGradeResult = calculateOverallFinalGrade(); // Assumes this function is correct
            const currentFinalGrade = calculatedGradeResult.finalGrade;
            // console.log(`[CalcLoop] Test Score: ${currentTestScore.toFixed(2)}, Overall Grade: ${currentFinalGrade !== null ? currentFinalGrade.toFixed(2) : 'N/A'}`);

            if (currentFinalGrade !== null && currentFinalGrade >= desiredOverallGrade) {
                minNeededScore = currentTestScore; // Store the score that achieved it
                finalGradeWithMinNeededScore = currentFinalGrade;
                //console.log(`[calculateMinScoreForAssignment] Success! Desired grade ${desiredOverallGrade}% achieved with score ${minNeededScore.toFixed(2)} (Overall: ${finalGradeWithMinNeededScore.toFixed(2)}%)`);
                break;
            }
        }

        currentClassData[targetAssignmentOriginalIndex].score = originalScore; // IMPORTANT: Restore original score
        //console.log(`[calculateMinScoreForAssignment] Restored original score for "${targetAssignment.name}": ${originalScore}`);

        if (minNeededScore !== null) {
            return {
                neededScore: parseFloat(minNeededScore.toFixed(2)), // Return with 2 decimal places
                pointsPossible: pointsPossible,
                isPossible: true,
                finalGradeAchieved: parseFloat(finalGradeWithMinNeededScore.toFixed(2))
            };
        } else {
            // If loop finishes, calculate max achievable grade with maxTestScore
            currentClassData[targetAssignmentOriginalIndex].score = maxTestScore;
            const maxAchievableGradeResult = calculateOverallFinalGrade();
            currentClassData[targetAssignmentOriginalIndex].score = originalScore; // Restore again

            //console.log(`[calculateMinScoreForAssignment] Failure. Desired grade ${desiredOverallGrade}% not achievable. Max overall with ${maxTestScore.toFixed(2)} on assignment: ${maxAchievableGradeResult.finalGrade !== null ? maxAchievableGradeResult.finalGrade.toFixed(2) : 'N/A'}%`);
            return {
                neededScore: null,
                pointsPossible: pointsPossible,
                isPossible: false,
                finalGradeAchieved: maxAchievableGradeResult.finalGrade !== null ? parseFloat(maxAchievableGradeResult.finalGrade.toFixed(2)) : null
            };
        }
    }

    function displayNeededScoresForAllCutoffs() {
        if (!whatIfAssignmentSelector || !whatIfResultsDisplay) return;
        const selectedIndex = whatIfAssignmentSelector.value;

        if (!selectedIndex || selectedIndex === "") {
            whatIfResultsDisplay.innerHTML = "<p>Please select an assignment first.</p>";
            return;
        }
        const targetAssignmentOriginalIndex = parseInt(selectedIndex, 10);
        const targetAssignment = currentClassData[targetAssignmentOriginalIndex];

        if (!targetAssignment) {
            whatIfResultsDisplay.innerHTML = "<p>Error: Selected assignment not found.</p>";
            console.error("[displayNeededScoresForAllCutoffs] Target assignment data not found for index:", targetAssignmentOriginalIndex);
            return;
        }

        const targetPointsPossible = parseFloat(targetAssignment.pointsPossible);
        if (isNaN(targetPointsPossible) || targetPointsPossible <= 0) {
            whatIfResultsDisplay.innerHTML = `<p>The selected assignment "${targetAssignment.name}" has invalid or zero points possible. Cannot perform calculation.</p>`;
            return;
        }

        // Read the extra credit percentage from the input field
        let extraCreditValue = parseFloat(extraCreditInput_whatIf.value);
        if (isNaN(extraCreditValue) || extraCreditValue < 0) {
            console.warn("[displayNeededScoresForAllCutoffs] Invalid extra credit percentage input, defaulting to 0.");
            extraCreditValue = 0; // Default to 0 if input is invalid
        }
        // Ensure the input field reflects the sanitized value if it was changed
        extraCreditInput_whatIf.value = extraCreditValue;

        whatIfResultsDisplay.innerHTML = `<h4>Needed scores for "${targetAssignment.name}" (Worth ${targetAssignment.pointsPossible} pts), considering up to ${extraCreditValue}% extra:</h4>`;
        const ul = document.createElement('ul');

        const sortedCutoffs = Object.entries(currentClassCutoffs)
            .sort(([, valA], [, valB]) => valB - valA); // Highest grade first

        let anyCalculationDone = false;
        for (const [grade, cutoffPercentage] of sortedCutoffs) {
            if (cutoffPercentage === null || isNaN(cutoffPercentage)) continue;
            anyCalculationDone = true;

            const result = calculateMinScoreForAssignment(targetAssignmentOriginalIndex, cutoffPercentage, extraCreditValue);
            const li = document.createElement('li');
            if (result.isPossible && result.neededScore !== null) {
                const neededPercentage = (result.neededScore / result.pointsPossible * 100).toFixed(2);
                li.innerHTML = `To get a <strong>${grade}</strong> (&GreaterEqual;${cutoffPercentage}% overall): 
                              Need <strong>${result.neededScore.toFixed(2)} / ${result.pointsPossible.toFixed(2)}</strong> 
                              (<em>${neededPercentage}% on this assignment</em>). 
                              <small>(Actual overall: ${result.finalGradeAchieved !== null ? result.finalGradeAchieved.toFixed(2) : 'N/A'}%)</small>`;
                 if (result.neededScore > result.pointsPossible) {
                    li.innerHTML += ` <strong style="color:orange;">(Requires extra credit)</strong>`;
                }
            } else {
                li.innerHTML = `To get a <strong>${grade}</strong> (&GreaterEqual;${cutoffPercentage}% overall): 
                              <strong style="color:red;">Not possible.</strong> 
                              <small>(Max possible overall grade if you get ${ (targetAssignment.pointsPossible * (1 + extraCreditValue / 100)).toFixed(2)}/${targetAssignment.pointsPossible.toFixed(2)} on this: ${result.finalGradeAchieved !== null ? result.finalGradeAchieved.toFixed(2) : 'N/A'}%)</small>`;
            }
            ul.appendChild(li);
        }
         if (!anyCalculationDone) {
            whatIfResultsDisplay.innerHTML = "<p>No valid grade cutoffs defined to calculate against.</p>";
        } else {
             whatIfResultsDisplay.appendChild(ul);
        }
    }

    function attachInputListeners(currentClassName, classSettingsKey) {
        gradesOutput.querySelectorAll('.editable-grade').forEach(input => {
            input.addEventListener('change', (event) => {
                const assignmentIndex = parseInt(event.target.dataset.assignmentIndex, 10);
                const property = event.target.dataset.property;
                const value = event.target.value.trim() === '' ? null : parseFloat(event.target.value);
                if (!isNaN(assignmentIndex) && currentClassData?.[assignmentIndex] && property && (value === null || !isNaN(value))) {
                    currentClassData[assignmentIndex][property] = value;
                    debouncedSaveAllClassesData();
                    updateCategoryDisplay(currentClassData[assignmentIndex].category || 'Uncategorized');
                } else if (value !== null && isNaN(value)) {
                    event.target.value = currentClassData?.[assignmentIndex]?.[property] ?? '';
                }
                populateWhatIfAssignmentSelector(); // Update the what-if selector to reflect changes
            });
            input.dataset.listenerAttached = 'true'; // Mark as having a listener
        });
        gradesOutput.querySelectorAll('.category-weight-input').forEach(input => {
            input.addEventListener('change', (event) => {
                const category = event.target.dataset.category;
                const weight = event.target.value.trim() === '' ? null : parseFloat(event.target.value);
                const classWeightsKey = currentClassName + '_weights'; // currentClassName is from the outer scope

                if (category && (weight === null || (!isNaN(weight) && weight >= 0))) { // Allow any positive weight
                    if (!globalAllClassesData[classWeightsKey]) {
                        globalAllClassesData[classWeightsKey] = {};
                    }
                    globalAllClassesData[classWeightsKey][category] = weight;
                    debouncedSaveAllClassesData();
                    updateOverallGradeDisplay(); // <<< THIS IS THE KEY LINE
                } else if (weight !== null && (isNaN(weight) || weight < 0)) { 
                    alert("Weight must be a non-negative number.");
                    // Revert to the old value if it exists, otherwise clear
                    event.target.value = (globalAllClassesData[classWeightsKey]?.[category]) ?? '';
                }
            });
            input.dataset.listenerAttached = 'true'; // To prevent multiple listeners
        });
        gradesOutput.querySelectorAll('.category-calc-method').forEach(select => {
            select.addEventListener('change', (event) => {
                const categoryName = event.target.dataset.category;
                const selectedMethod = event.target.value;
                if (!globalAllClassesData[classSettingsKey]) globalAllClassesData[classSettingsKey] = { categoryCalcMethods: {}, categoryDrops: {} };
                if (!globalAllClassesData[classSettingsKey].categoryCalcMethods) globalAllClassesData[classSettingsKey].categoryCalcMethods = {};
                if (!globalAllClassesData[classSettingsKey].categoryDrops) globalAllClassesData[classSettingsKey].categoryDrops = {};
                globalAllClassesData[classSettingsKey].categoryCalcMethods[categoryName] = selectedMethod;
                debouncedSaveAllClassesData();
                updateCategoryDisplay(categoryName);
            });
            select.dataset.listenerAttached = 'true';
        });

        // Add listeners for dynamically added "Add Assignment" buttons
        gradesOutput.querySelectorAll('.show-add-assignment-form').forEach(button => {
            if (button.dataset.listenerAttached === 'true') return;
            button.addEventListener('click', (event) => {
                const formId = event.target.dataset.formId;
                const formElement = document.getElementById(formId);
                if (formElement) formElement.style.display = 'block';
                event.target.style.display = 'none'; // Hide the "+ Add Assignment" button
            });
            button.dataset.listenerAttached = 'true';
        });

        gradesOutput.querySelectorAll('.confirm-add-assignment').forEach(button => {
            if (button.dataset.listenerAttached === 'true') return;
            button.addEventListener('click', (event) => {
                const categoryName = event.target.dataset.category;
                const formId = event.target.dataset.formId;
                const formElement = document.getElementById(formId);
                if (formElement) {
                    handleAddAssignmentFromForm(currentClassName, categoryName, formElement);
                    // Hiding the form is handled by re-render in handleAddAssignmentFromForm
                }
            });
            button.dataset.listenerAttached = 'true';
        });
        
        gradesOutput.querySelectorAll('.cancel-add-item').forEach(button => {
            if (button.dataset.listenerAttached === 'true') return;
            button.addEventListener('click', (event) => {
                const formId = event.target.dataset.formId;
                const formElement = document.getElementById(formId);
                const showButtonSelector = `.show-add-assignment-form[data-form-id="${formId}"]`;
                const showButton = gradesOutput.querySelector(showButtonSelector); // Query within gradesOutput

                if (formElement) {
                    formElement.style.display = 'none';
                    // Clear form inputs
                    formElement.querySelectorAll('input[type="text"], input[type="number"]').forEach(input => input.value = '');
                }
                if (showButton) showButton.style.display = 'inline-block'; // Show the "+ Add Assignment" button again
                else { // Fallback for global add category cancel
                    const globalShowButton = document.getElementById('show-add-category-form-global');
                    if(globalShowButton && formId === 'add-category-form-global') globalShowButton.style.display = 'inline-block';
                }
            });
            button.dataset.listenerAttached = 'true';
        });

        gradesOutput.querySelectorAll('.delete-assignment-icon').forEach(icon => {
            if (icon.dataset.listenerAttached === 'true') return;
            icon.addEventListener('click', (event) => {
                // The originalIndex is on the parent .assignment div
                const assignmentDiv = event.target.closest('.assignment');
                const originalIndex = parseInt(assignmentDiv.dataset.assignmentOriginalIndex, 10);
                if (!isNaN(originalIndex)) {
                    handleDeleteAssignment(currentClassName, originalIndex);
                } else {
                    console.error("Could not get original index for assignment deletion.");
                }
            });
            icon.dataset.listenerAttached = 'true';
        });

        gradesOutput.querySelectorAll('.delete-category-icon').forEach(icon => {
            if (icon.dataset.listenerAttached === 'true') return;
            icon.addEventListener('click', (event) => {
                const categoryName = event.target.dataset.category;
                handleDeleteCategory(currentClassName, categoryName);
            });
            icon.dataset.listenerAttached = 'true';
        });

        gradesOutput.querySelectorAll('.category-drops-input').forEach(input => {
            if (input.dataset.listenerAttached === 'true') return;
            input.addEventListener('change', (event) => {
                const category = event.target.dataset.category;
                let drops = parseInt(event.target.value, 10);

                if (isNaN(drops) || drops < 0) drops = 0; // Default to 0 if invalid
                event.target.value = drops; // Ensure input reflects sanitized value

                if (!globalAllClassesData[classSettingsKey]) globalAllClassesData[classSettingsKey] = { categoryCalcMethods: {}, categoryDrops: {} };
                if (!globalAllClassesData[classSettingsKey].categoryDrops) globalAllClassesData[classSettingsKey].categoryDrops = {};

                globalAllClassesData[classSettingsKey].categoryDrops[category] = drops;
                debouncedSaveAllClassesData();
                updateCategoryDisplay(category); // Recalculate category and overall grade
            });
            input.dataset.listenerAttached = 'true';
        });

        // Listener for Toggle Exclude Assignment Icon
        gradesOutput.querySelectorAll('.toggle-exclude-assignment-icon').forEach(icon => {
            if (icon.dataset.listenerAttached === 'true') return;
            icon.addEventListener('click', (event) => {
                const assignmentOriginalIndex = parseInt(event.target.dataset.assignmentIndex, 10);
                if (!isNaN(assignmentOriginalIndex) && currentClassData?.[assignmentOriginalIndex]) {
                    const assignment = currentClassData[assignmentOriginalIndex];
                    assignment.isExcluded = !assignment.isExcluded; // Toggle status

                    // Update UI
                    const assignmentDiv = event.target.closest('.assignment');
                    if (assignmentDiv) {
                        assignmentDiv.classList.toggle('excluded-assignment', assignment.isExcluded);
                    }
                    event.target.innerHTML = assignment.isExcluded ? '&#128064;' : '&#128065;'; // Toggle icon (closed/open eye)
                    event.target.title = assignment.isExcluded ? "Include Assignment" : "Exclude Assignment";


                    debouncedSaveAllClassesData();
                    updateCategoryDisplay(assignment.category || 'Uncategorized');
                }
            });
            icon.dataset.listenerAttached = 'true';
        });
        
        if (saveCutoffsButton) saveCutoffsButton.addEventListener('click', saveCustomCutoffs);
        if (resetCutoffsButton) resetCutoffsButton.addEventListener('click', resetDefaultCutoffs);
        if (calculateNeededForCutoffsButton) calculateNeededForCutoffsButton.addEventListener('click', displayNeededScoresForAllCutoffs);

        // If classSelector listener is here, ensure it calls populateWhatIfAssignmentSelector
         classSelector.addEventListener('change', (event) => {
            const selectedClass = event.target.value;
            currentClassNameForDisplay = selectedClass; // This is already set
            if (selectedClass) {
                displayGradesForClass(selectedClass, globalAllClassesData); // This will re-init everything
                // The populateWhatIfAssignmentSelector() is called inside displayGradesForClass
            } else {
                gradesOutput.innerHTML = '<p>Please select a class to view its grades.</p>';
                currentClassData = null;
                deleteClassButton.style.display = 'none';
                if (overallGradeContainer) overallGradeContainer.style.display = 'none';
                if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'none';
                if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'none';
                // updateCategoryDisplay(); // Clear category display - this function might not exist or need adjustment
            }
        });


        // Add Category form listeners (also check for existing listeners if re-rendering often)
        const showAddCategoryFormButton = document.getElementById('show-add-category-form');
        const addCategoryForm = document.getElementById('add-category-form');
        const confirmAddCategoryButton = document.getElementById('confirm-add-category');
        const cancelAddCategoryButton = document.getElementById('cancel-add-category');
        const newCategoryNameInput = document.getElementById('new-category-name');

        if (showAddCategoryFormButton && !showAddCategoryFormButton.dataset.listenerAttached) {
            showAddCategoryFormButton.addEventListener('click', () => {
                if(addCategoryForm) addCategoryForm.style.display = 'block';
                showAddCategoryFormButton.style.display = 'none';
            });
            showAddCategoryFormButton.dataset.listenerAttached = 'true';
        }
        if (cancelAddCategoryButton && !cancelAddCategoryButton.dataset.listenerAttached) {
            cancelAddCategoryButton.addEventListener('click', () => {
                if(addCategoryForm) addCategoryForm.style.display = 'none';
                if(newCategoryNameInput) newCategoryNameInput.value = '';
                if(showAddCategoryFormButton) showAddCategoryFormButton.style.display = 'inline-block';
            });
            cancelAddCategoryButton.dataset.listenerAttached = 'true';
        }
        if (confirmAddCategoryButton && !confirmAddCategoryButton.dataset.listenerAttached) {
            confirmAddCategoryButton.addEventListener('click', () => {
                const newCategoryName = newCategoryNameInput ? newCategoryNameInput.value.trim() : "";
                if (newCategoryName) {
                    handleAddCategory(currentClassName, newCategoryName);
                    if(addCategoryForm) addCategoryForm.style.display = 'none';
                    if(newCategoryNameInput) newCategoryNameInput.value = '';
                    if(showAddCategoryFormButton) showAddCategoryFormButton.style.display = 'inline-block';
                } else { alert("Please enter a name for the new category."); }
            });
            confirmAddCategoryButton.dataset.listenerAttached = 'true';
        }
    }
    
    function loadCategoryWeights(currentClassName) {
        const weightsData = globalAllClassesData[currentClassName + '_weights'];
        gradesOutput.querySelectorAll('.category-weight-input').forEach(input => {
            const category = input.dataset.category;
            input.value = (weightsData?.[category]) ?? '';
        });
    }

    function loadCategorySettings(currentClassName) {
        const classSettings = globalAllClassesData[currentClassName + '_settings'];
        if (classSettings && classSettings.categoryDrops) {
            gradesOutput.querySelectorAll('.category-drops-input').forEach(input => {
                const category = input.dataset.category;
                input.value = classSettings.categoryDrops[category] || 0;
            });
        }
    }

    function populateClassSelector(allClassesData, selectedClassName = null) {
        const classNames = Object.keys(allClassesData).filter(key => !key.endsWith('_weights') && !key.endsWith('_settings'));
        classSelector.innerHTML = ''; // Clear existing options
        const hasClasses = classNames.length > 0;
        const defaultOptionText = hasClasses ? "--Select a Class--" : "--No Classes Stored--";
        
        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = defaultOptionText;
        classSelector.appendChild(defaultOption);

        if (hasClasses) {
            classNames.sort().forEach(className => {
                const option = document.createElement('option');
                option.value = className;
                option.textContent = className;
                classSelector.appendChild(option);
            });
        }
        
        // Attempt to select the class if provided via URL parameter and it exists
        if (selectedClassName && classNames.includes(selectedClassName)) {
            classSelector.value = selectedClassName;
        }
        // After setting the value (or if it defaults to ""),
        // set currentClassNameForDisplay and call displayGradesForClass if a class is actually selected.
        if (classSelector.value) {
            currentClassNameForDisplay = classSelector.value;
             // This will load grade cutoffs from storage or defaults
            displayGradesForClass(currentClassNameForDisplay, globalAllClassesData);
        } else {
            // No class is selected (e.g., "--Select a Class--" or "--No Classes Stored--")
            currentClassNameForDisplay = null; // Ensure it's cleared
            gradesOutput.innerHTML = hasClasses ? '<p>Please select a class to view its grades.</p>' : '<p>No classes scraped. Go to Canvas grades & use extension.</p>';
            deleteClassButton.style.display = 'none';
            if (overallGradeContainer) overallGradeContainer.style.display = 'none';
            if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'none';
            if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'none';
            updateOverallGradeDisplay(); // Clear overall display
        }
    }

    function handleDeleteClass() {
        const selectedClass = classSelector.value;
        if (!selectedClass) { alert("Please select a class to delete."); return; }
        if (confirm(`Are you sure you want to delete all data for "${selectedClass}"? This cannot be undone.`)) {
            delete globalAllClassesData[selectedClass];
            delete globalAllClassesData[selectedClass + '_weights'];
            delete globalAllClassesData[selectedClass + '_settings'];
            chrome.storage.local.set({ 'allClassesData': globalAllClassesData }, () => {
                currentClassData = null;
                populateClassSelector(globalAllClassesData, null);
                gradesOutput.innerHTML = '<p>Class deleted. Please select another class or scrape new data.</p>';
                deleteClassButton.style.display = 'none'; 
            });
        }
    }

    chrome.storage.local.get('allClassesData', (result) => {
        globalAllClassesData = result.allClassesData || {};
        const urlParams = new URLSearchParams(window.location.search);
        const classNameFromUrl = urlParams.get('className');

        // Populate selector, attempting to select class from URL if provided
        populateClassSelector(globalAllClassesData, classNameFromUrl); 

        // Event listener for class selector changes by the user
        classSelector.addEventListener('change', (event) => {
            const selectedClass = event.target.value;
            currentClassNameForDisplay = selectedClass; // Update global tracking
            if (selectedClass) {
                // This will load grade cutoffs from storage or defaults
                displayGradesForClass(selectedClass, globalAllClassesData);
            } else { // "--Select Class--" chosen
                gradesOutput.innerHTML = '<p>Please select a class to view its grades.</p>';
                currentClassData = null;
                currentClassNameForDisplay = null; // Explicitly clear
                deleteClassButton.style.display = 'none';
                if (overallGradeContainer) overallGradeContainer.style.display = 'none';
                if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'none';
                if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'none';
                updateOverallGradeDisplay(); // Clear/reset overall display
            }
        });
        
        deleteClassButton.addEventListener('click', handleDeleteClass);
    });
});