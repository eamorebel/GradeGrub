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
    //const whatIfAssignmentSelector = document.getElementById('what-if-assignment-selector');
    const extraCreditInput_whatIf = document.getElementById('extra-credit-percentage_what-if'); 
    const calculateNeededForCutoffsButton = document.getElementById('calculate-needed-for-cutoffs-button');
    const clearWhatIfSelectionButton = document.getElementById('clear-what-if-selection-button');
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

        const classSettingsKey = currentClassNameForDisplay + '_settings';
        const classSettings = globalAllClassesData[classSettingsKey] || {};
        const categoryPolicySettings = (classSettings.categoryReplacePolicies && classSettings.categoryReplacePolicies[categoryName])
                                    ? classSettings.categoryReplacePolicies[categoryName]
                                    : { policy: 'none', finalAssignmentOriginalIndex: null };

        let replacedAssignmentOriginalIndices = new Set(); // Initialize this set

        let assignmentsForCategory = currentClassData
            .map((asm, index) => ({ ...asm, originalIndex: index, effectiveScore: parseFloat(asm.score), isReplaced: false }))
            .filter(assignment => (assignment.category || 'Uncategorized') === categoryName && !assignment.isExcluded);

        let gradableAssignmentsForPolicy = assignmentsForCategory.filter(asm => {
            const score = asm.effectiveScore;
            const possible = parseFloat(asm.pointsPossible);
            return !isNaN(score) && !isNaN(possible) && possible > 0;
        });

        if (gradableAssignmentsForPolicy.length > 0) {
            if (categoryPolicySettings.policy === 'finalReplacesLowest' && categoryPolicySettings.finalAssignmentOriginalIndex !== null) {
                const finalAssignmentGlobal = currentClassData[categoryPolicySettings.finalAssignmentOriginalIndex];

                if (finalAssignmentGlobal && !finalAssignmentGlobal.isExcluded &&
                    parseFloat(finalAssignmentGlobal.pointsPossible) > 0 && !isNaN(parseFloat(finalAssignmentGlobal.score))) {

                    const finalAsmPercentage = (parseFloat(finalAssignmentGlobal.score) / parseFloat(finalAssignmentGlobal.pointsPossible));
                    let lowestAsmForReplacement = null;
                    let lowestAsmPercentage = Infinity;

                    gradableAssignmentsForPolicy.forEach(asm => {
                        if (asm.originalIndex === categoryPolicySettings.finalAssignmentOriginalIndex && (asm.category || "Uncategorized") === (finalAssignmentGlobal.category || "Uncategorized") ) return; // Don't replace final with itself if in same category

                        const currentAsmPercentage = (asm.effectiveScore / parseFloat(asm.pointsPossible));
                        if (currentAsmPercentage < lowestAsmPercentage) {
                            lowestAsmPercentage = currentAsmPercentage;
                            lowestAsmForReplacement = asm;
                        }
                    });

                    if (lowestAsmForReplacement && finalAsmPercentage > lowestAsmPercentage) {
                        const indexToUpdateInWorkingArray = assignmentsForCategory.findIndex(a => a.originalIndex === lowestAsmForReplacement.originalIndex);
                        if (indexToUpdateInWorkingArray !== -1) {
                            assignmentsForCategory[indexToUpdateInWorkingArray].effectiveScore = finalAsmPercentage * parseFloat(assignmentsForCategory[indexToUpdateInWorkingArray].pointsPossible);
                            assignmentsForCategory[indexToUpdateInWorkingArray].isReplaced = true;
                            replacedAssignmentOriginalIndices.add(lowestAsmForReplacement.originalIndex);
                        }
                    }
                }
            } else if (categoryPolicySettings.policy === 'replaceLowWithCategoryAverage') {
                if (gradableAssignmentsForPolicy.length > 1) {
                    let lowestAsmForReplacement = null;
                    let lowestAsmPercentage = Infinity;
                    let lowestAsmOriginalIndex = -1;

                    gradableAssignmentsForPolicy.forEach(asm => {
                        const currentAsmPercentage = (asm.effectiveScore / parseFloat(asm.pointsPossible));
                        if (currentAsmPercentage < lowestAsmPercentage) {
                            lowestAsmPercentage = currentAsmPercentage;
                            lowestAsmForReplacement = asm;
                            lowestAsmOriginalIndex = asm.originalIndex;
                        }
                    });

                    if (lowestAsmForReplacement) {
                        const includeLowestInAvgCalc = categoryPolicySettings.includeLowestInAvg || false; // Default to false

                        let tempSumScores = 0;
                        let tempSumPossible = 0;
                        let tempCountForAvg = 0;
                        let tempSumPercForEqual = 0;

                        gradableAssignmentsForPolicy.forEach(asm => {
                            // Conditionally skip the lowest assignment if 'includeLowestInAvgCalc' is false
                            if (!includeLowestInAvgCalc && asm.originalIndex === lowestAsmOriginalIndex) {
                                return; // Exclude the identified lowest assignment from this preliminary average calculation
                            }

                            // The rest of the accumulation logic remains the same
                            if (calculationMethod === 'equalWeight') {
                                if (parseFloat(asm.pointsPossible) > 0 && !isNaN(asm.effectiveScore)) {
                                    tempSumPercForEqual += (asm.effectiveScore / parseFloat(asm.pointsPossible));
                                    tempCountForAvg++;
                                }
                            } else { // totalPoints
                                if (!isNaN(asm.effectiveScore)) tempSumScores += asm.effectiveScore;
                                if (parseFloat(asm.pointsPossible) > 0) tempSumPossible += parseFloat(asm.pointsPossible);
                            }
                        });

                        let preliminaryAveragePercentage = 0;
                        if (calculationMethod === 'equalWeight' && tempCountForAvg > 0) {
                            preliminaryAveragePercentage = (tempSumPercForEqual / tempCountForAvg);
                        } else if (calculationMethod === 'totalPoints' && tempSumPossible > 0) {
                            preliminaryAveragePercentage = (tempSumScores / tempSumPossible);
                        } else if (calculationMethod === 'totalPoints' && tempSumScores > 0 && tempSumPossible === 0 && tempCountForAvg === 0) { // All bonus case
                            preliminaryAveragePercentage = 1; // Treat avg as 100% if only bonus scores contribute
                        }

                        if (preliminaryAveragePercentage > lowestAsmPercentage) {
                            const indexToUpdateInWorkingArray = assignmentsForCategory.findIndex(a => a.originalIndex === lowestAsmOriginalIndex);
                            if (indexToUpdateInWorkingArray !== -1) {
                                assignmentsForCategory[indexToUpdateInWorkingArray].effectiveScore = preliminaryAveragePercentage * parseFloat(assignmentsForCategory[indexToUpdateInWorkingArray].pointsPossible);
                                assignmentsForCategory[indexToUpdateInWorkingArray].isReplaced = true;
                                replacedAssignmentOriginalIndices.add(lowestAsmOriginalIndex);
                            }
                        }
                    }
                }
            }
        }
        // Update gradableAssignmentsForPolicy in case scores changed due to policy
        gradableAssignmentsForPolicy = assignmentsForCategory.filter(asm => {
            const score = asm.effectiveScore;
            const possible = parseFloat(asm.pointsPossible);
            return !isNaN(score) && !isNaN(possible) && possible > 0;
        });

        const numDropsForCategory = parseInt(classSettings.categoryDrops?.[categoryName], 10) || 0;
        let actualDroppedCount = 0;
        let droppedAssignmentOriginalIndices = new Set();

        if (numDropsForCategory > 0 && assignmentsForCategory.length > 0) {
            let droppableAssignments = assignmentsForCategory
                .filter(asm => {
                    const score = asm.effectiveScore;
                    const possible = parseFloat(asm.pointsPossible);
                    // Only drop if it's gradable AND NOT already replaced by a policy
                    return !isNaN(score) && !isNaN(possible) && possible > 0 && !asm.isReplaced;
                });

            if (droppableAssignments.length > numDropsForCategory) {
                droppableAssignments.sort((a, b) => {
                    const percA = (a.effectiveScore / parseFloat(a.pointsPossible));
                    const percB = (b.effectiveScore / parseFloat(b.pointsPossible));
                    return percA - percB;
                });
                const assignmentsToActuallyDrop = droppableAssignments.slice(0, numDropsForCategory);
                actualDroppedCount = assignmentsToActuallyDrop.length;
                assignmentsToActuallyDrop.forEach(asm => droppedAssignmentOriginalIndices.add(asm.originalIndex));
            } else if (droppableAssignments.length > 0) {
                actualDroppedCount = droppableAssignments.length;
                droppableAssignments.forEach(asm => droppedAssignmentOriginalIndices.add(asm.originalIndex));
            }
            // Filter out the dropped assignments from the list used for final calculation
            assignmentsForCategory = assignmentsForCategory.filter(asm => !droppedAssignmentOriginalIndices.has(asm.originalIndex));
        }


        // --- 3. Calculate totals with the remaining assignments (using effectiveScore) ---
        let totalScore = 0, totalPossible = 0, validAssignmentsCount = 0, hasGradedItems = false;

        if (calculationMethod === 'equalWeight') {
            let sumOfIndividualPercentages = 0;
            assignmentsForCategory.forEach(asm => {
                const score = asm.effectiveScore; // USE EFFECTIVE SCORE
                const possible = parseFloat(asm.pointsPossible);
                if (!isNaN(score) && !isNaN(possible) && possible > 0) {
                    sumOfIndividualPercentages += (score / possible);
                    validAssignmentsCount++;
                    hasGradedItems = true;
                } else if (asm.score !== null && asm.score !== undefined) {
                    hasGradedItems = true;
                }
            });
            totalScore = sumOfIndividualPercentages;
            totalPossible = validAssignmentsCount;
        } else { // totalPoints
            assignmentsForCategory.forEach(asm => {
                const score = asm.effectiveScore; // USE EFFECTIVE SCORE
                const possible = parseFloat(asm.pointsPossible);
                if (!isNaN(score)) {
                    totalScore += score;
                    hasGradedItems = true;
                }
                if (!isNaN(possible) && possible > 0) {
                    totalPossible += possible;
                    if (asm.score === null || asm.score === undefined) hasGradedItems = true;
                } else if (!isNaN(score) && (isNaN(possible) || possible === 0)) {
                    hasGradedItems = true;
                }
            });
        }

        let percentage = 0;
        if (totalPossible > 0) {
            percentage = (calculationMethod === 'equalWeight' ? totalScore / totalPossible : totalScore / totalPossible) * 100;
        } else if (hasGradedItems && totalPossible === 0 && calculationMethod === 'totalPoints') {
            if (totalScore > 0) percentage = 100;
            else percentage = 0;
        } else if (calculationMethod === 'equalWeight' && validAssignmentsCount === 0 && hasGradedItems) {
            percentage = 0;
        }

        // Update the visual style for replaced assignments
        assignmentsForCategory.forEach(asm => {
            const asmEl = document.getElementById(`assignment-${asm.originalIndex}`);
            if (asmEl) {
                if (asm.isReplaced) {
                    asmEl.classList.add('replaced-assignment'); // You'll need to style this class
                    asmEl.title = `Original score: ${asm.score}. Score replaced with ${asm.effectiveScore.toFixed(2)} by policy.`;
                } else {
                    asmEl.classList.remove('replaced-assignment');
                    asmEl.title = '';
                }
            }
        });


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
            if (unweightedTotalDisplay) unweightedTotalDisplay.innerHTML = ''; // Use innerHTML and clear
            return;
        }

        const gradeData = calculateOverallFinalGrade();

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
            let unweightedHtml = `Unweighted Average of Category Percentages: ${gradeData.unweightedAverage.toFixed(2)}%. `;
            unweightedHtml += `Total Weight Applied: ${gradeData.totalWeightApplied.toFixed(1)}%.`;
            
            if (gradeData.warnings.length > 0 && !gradeData.warnings.includes("No class data.")) {
                // Wrap warnings in a span with style for red and bold
                const warningMessages = gradeData.warnings.join('; ');
                unweightedHtml += ` <br><span style="color: red; font-weight: bold;">Warnings: ${warningMessages}</span>`;
            }
            
            unweightedTotalDisplay.innerHTML = unweightedHtml; // Use innerHTML to render the span
            // No need for unweightedTotalDisplay.style.whiteSpace = 'pre-line'; as <br> handles line break
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
        
        // Recalculate to get fresh droppedAssignmentOriginalIndices and replacedAssignmentOriginalIndices
        const freshCalcResult = calculateCategoryTotal(categoryName, selectedMethod);

        const totalDisplay = categoryGroupDiv.querySelector('.category-total-display');
        if (totalDisplay) {
            let displayFormat = freshCalcResult.methodUsed === 'equalWeight' ?
                `Category Average: ${freshCalcResult.percentage.toFixed(2)}% (from ${freshCalcResult.totalPossible} assignments)` :
                `Category Total: ${freshCalcResult.totalScore.toFixed(2)} / ${freshCalcResult.totalPossible.toFixed(2)} (${freshCalcResult.percentage.toFixed(2)}%)`;
            if (freshCalcResult.droppedCount > 0) {
                displayFormat += ` (${freshCalcResult.droppedCount} dropped)`;
            }
            totalDisplay.textContent = displayFormat;
            if (!freshCalcResult.hasGradedItems && freshCalcResult.droppedCount === 0 && (!freshCalcResult.replacedAssignmentOriginalIndices || freshCalcResult.replacedAssignmentOriginalIndices.size ===0) ) {
                totalDisplay.textContent += " (No graded items)";
            }
        }

        if (categoryGroupDiv) {
            const assignmentElements = categoryGroupDiv.querySelectorAll('.assignment');

            assignmentElements.forEach(asmEl => {
                const originalIndex = parseInt(asmEl.dataset.assignmentOriginalIndex, 10);
                if (isNaN(originalIndex) || !currentClassData || !currentClassData[originalIndex]) return;

                const assignmentData = currentClassData[originalIndex]; // The master data
                const isManuallyExcluded = assignmentData.isExcluded;
                const isAutomaticallyDropped = freshCalcResult.droppedAssignmentOriginalIndices && freshCalcResult.droppedAssignmentOriginalIndices.has(originalIndex);
                const isReplacedByPolicy = freshCalcResult.replacedAssignmentOriginalIndices && freshCalcResult.replacedAssignmentOriginalIndices.has(originalIndex);

                // Clear all status classes first
                asmEl.classList.remove('excluded-assignment', 'dropped-assignment', 'replaced-assignment');
                asmEl.title = ""; // Clear previous title

                if (isReplacedByPolicy) {
                    asmEl.classList.add('replaced-assignment');
                    asmEl.title = `Original score: ${assignmentData.score !== null ? assignmentData.score : 'N/A'}. Score replaced with ${asm.effectiveScore !== null ? asm.effectiveScore.toFixed(2) : 'N/A'} by policy.`;
                } else if (isAutomaticallyDropped) {
                    asmEl.classList.add('dropped-assignment');
                    asmEl.title = "This assignment was automatically dropped.";
                } else if (isManuallyExcluded) {
                    asmEl.classList.add('excluded-assignment');
                    asmEl.title = "This assignment is manually excluded from calculations.";
                }

                // Update exclude icon (this is independent of the above mutually exclusive styling)
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
        if (!classSettings.categoryReplacePolicies) classSettings.categoryReplacePolicies = {}; // Initialize replace policies

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
                const categoryPolicySettings = classSettings.categoryReplacePolicies[categoryName] || { policy: 'none', finalAssignmentOriginalIndex: null };

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
                outputHTML += `    <div class="category-setting-item" style="margin-left: 10px;">`; // Wrapper for better layout
                outputHTML += `        <label for="category-replace-policy-${categoryIdSafeForHtmlId}">Replace Policy: </label>`;
                outputHTML += `        <select class="category-replace-policy" data-category="${categoryName}" id="category-replace-policy-${categoryIdSafeForHtmlId}">`;
                outputHTML += `            <option value="none">None</option>`;
                outputHTML += `            <option value="finalReplacesLowest">Final Replaces Lowest</option>`;
                outputHTML += `            <option value="replaceLowWithCategoryAverage">Replace Low w/ Cat. Avg</option>`;
                outputHTML += `        </select>`;
                outputHTML += `    </div>`;
                outputHTML += `    <div id="include-lowest-in-avg-container-${categoryIdSafeForHtmlId}" class="category-setting-item" style="display:none; margin-left: 10px; font-size: 0.9em;">`;
                outputHTML += `        <input type="checkbox" class="include-lowest-in-avg-checkbox" data-category="${categoryName}" id="include-lowest-in-avg-${categoryIdSafeForHtmlId}">`;
                outputHTML += `        <label for="include-lowest-in-avg-${categoryIdSafeForHtmlId}">Include lowest in avg. calculation</label>`;
                outputHTML += `    </div>`;
                outputHTML += `    <div id="final-assignment-selector-container-${categoryIdSafeForHtmlId}" class="category-setting-item" style="display:none; margin-left: 10px;">`;
                outputHTML += `        <label for="final-assignment-selector-${categoryIdSafeForHtmlId}">Select Final: </label>`;
                outputHTML += `        <select class="final-assignment-selector" data-category="${categoryName}" id="final-assignment-selector-${categoryIdSafeForHtmlId}">`;
                outputHTML += `            <option value="">--Select Final Assignment--</option>`;
                outputHTML += `        </select>`;
                outputHTML += `    </div>`;
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
                    outputHTML += `  <input type="checkbox" class="what-if-assignment-checkbox" data-assignment-original-index="${assignment.originalIndex}" style="margin-right: 8px;">`
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
            loadCategoryReplacePolicies(className); // For replace policies
            categories.forEach(categoryName => {
                if (categoryName) updateCategoryDisplay(categoryName);
            });
            updateOverallGradeDisplay();

            if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'block';
            if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'block';

            //console.log("[displayGradesForClass] About to render cutoff inputs and populate what-if selector.");
            renderGradeCutoffInputs();
            updateCalculateNeededButtonState();
            //populateWhatIfAssignmentSelector();

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

    function getSelectedWhatIfAssignments() {
        const selectedAssignments = [];
        document.querySelectorAll('.what-if-assignment-checkbox:checked').forEach(checkbox => {
            selectedAssignments.push(parseInt(checkbox.dataset.assignmentOriginalIndex, 10));
        });
        return selectedAssignments;
    }

    function updateCalculateNeededButtonState() {
        const selectedAssignments = getSelectedWhatIfAssignments();
        if (calculateNeededForCutoffsButton) {
            if (selectedAssignments.length === 0) {
                calculateNeededForCutoffsButton.disabled = true;
                //change text to "Select an assignment"
                calculateNeededForCutoffsButton.textContent = 'Select an assignment';
                // gray out the button
                calculateNeededForCutoffsButton.style.backgroundColor = '#ccc';
                calculateNeededForCutoffsButton.style.color = '#666';
            } else {
                calculateNeededForCutoffsButton.disabled = false;
                //change text back to original
                calculateNeededForCutoffsButton.textContent = 'Calculate Needed Scores for All Cutoffs';
                // reset button color
                calculateNeededForCutoffsButton.style.backgroundColor = '';
                calculateNeededForCutoffsButton.style.color = '';
            }
        }
        whatIfResultsDisplay.innerHTML = '';
    }

    function resetWhatIfCalculator() {
         calculateNeededForCutoffsButton.disabled = true;
         whatIfResultsDisplay.innerHTML = '';
    }

    function clearWhatIfSelection() {
        document.querySelectorAll('.what-if-assignment-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });
        updateCalculateNeededButtonState(); // This will disable the "Calculate" button
        if (whatIfResultsDisplay) {
            whatIfResultsDisplay.innerHTML = ''; // Clear any previous calculation results
        }
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
     * @param {number[]} targetAssignmentOriginalIndices - Array of original indices of the assignments in currentClassData.
     * @param {number} desiredOverallGrade - The target final grade percentage (e.g., 94 for an A).
     * @param {number} extraCreditPercent - The percentage of extra credit to consider (e.g., 25 for 25% extra).
     * @returns {object} An object { neededPercentage: number | null, isPossible: boolean, finalGradeAchieved: number | null, individualResults: array }
     * neededScore is null if not possible or assignment invalid.
     */
    function calculateMinScoreForAssignments(targetAssignmentOriginalIndices, desiredOverallGrade, extraCreditPercent) {
        //console.log(`[calculateMinScoreForAssignments] Indices: ${targetAssignmentOriginalIndices.join(', ')}, Desired Overall: ${desiredOverallGrade}%`);
        if (!currentClassData || targetAssignmentOriginalIndices.length === 0) {
            console.error("[calculateMinScoreForAssignments] No target assignments selected or no class data.");
            return { neededPercentage: null, isPossible: false, finalGradeAchieved: null, individualResults: [] };
        }
            
        const originalScores = targetAssignmentOriginalIndices.map(index => currentClassData[index].score);
        const targetAssignmentsData = [];

        for (const index of targetAssignmentOriginalIndices) {
            const assignment = currentClassData[index];
            const pointsPossible = parseFloat(assignment.pointsPossible);
            if (isNaN(pointsPossible) || pointsPossible <= 0) {
                console.warn(`[calculateMinScoreForAssignments] Target assignment "${assignment.name}" has invalid points possible (${assignment.pointsPossible}). Cannot calculate for this assignment.`);
                 // Restore original scores for all processed assignments before returning
                targetAssignmentOriginalIndices.forEach((idx, i) => { currentClassData[idx].score = originalScores[i]; });
                return { neededPercentage: null, isPossible: false, finalGradeAchieved: null, individualResults: [] }; // Or handle more gracefully
            }
            targetAssignmentsData.push({ originalIndex: index, name: assignment.name, pointsPossible: pointsPossible });
        }

        let minNeededPercentage = null;
        const multiplier = 1 + (parseFloat(extraCreditPercent) / 100);
        const maxTestPercentage = multiplier; // Max percentage to test (e.g., 1.25 for 125%)
        const step = 1 / 2000; // Step size for iteration

        //console.log(`[calculateMinScoreForAssignments] Iterating percentage (0 to ${maxTestPercentage.toFixed(4)}) with step ${step}`);

        for (let testPercentage = 0; testPercentage <= maxTestPercentage; testPercentage += step) {
            const currentTestPercentage = parseFloat(testPercentage.toFixed(4));

            targetAssignmentsData.forEach(asmData => {
                currentClassData[asmData.originalIndex].score = asmData.pointsPossible * currentTestPercentage;
            });

            const calculatedGradeResult = calculateOverallFinalGrade(); // Assumes this function is correct
            const currentFinalGrade = calculatedGradeResult.finalGrade;
            //console.log(`[CalcLoop] Test Percentage: ${(currentTestPercentage * 100).toFixed(2)}%, Overall Grade: ${currentFinalGrade !== null ? currentFinalGrade.toFixed(2) : 'N/A'}`);

            if (currentFinalGrade !== null && currentFinalGrade >= desiredOverallGrade) {
                minNeededPercentage = currentTestPercentage;
                finalGradeWithMinNeededScore = currentFinalGrade;
                //console.log(`[calculateMinScoreForAssignments] Success! Desired grade ${desiredOverallGrade}% achieved with percentage ${(minNeededPercentage * 100).toFixed(2)}% (Overall: ${finalGradeWithMinNeededScore.toFixed(2)}%)`);
                break;
            }
        }

        // IMPORTANT: Restore original scores
        targetAssignmentOriginalIndices.forEach((index, i) => {
            currentClassData[index].score = originalScores[i];
        });
        //console.log(`[calculateMinScoreForAssignments] Restored original scores.`);

        if (minNeededPercentage !== null) {
            const individualResults = targetAssignmentsData.map(asmData => ({
                originalIndex: asmData.originalIndex,
                name: asmData.name,
                neededScore: parseFloat((asmData.pointsPossible * minNeededPercentage).toFixed(2)),
                pointsPossible: asmData.pointsPossible
            }));
            return {
                neededPercentage: parseFloat((minNeededPercentage * 100).toFixed(2)), // As a percentage
                isPossible: true,
                finalGradeAchieved: parseFloat(finalGradeWithMinNeededScore.toFixed(2)),
                individualResults: individualResults
            };
        } else {
            // If loop finishes, calculate max achievable grade with maxTestScore
            // If loop finishes, calculate max achievable grade with maxTestPercentage
            targetAssignmentsData.forEach(asmData => {
                currentClassData[asmData.originalIndex].score = asmData.pointsPossible * maxTestPercentage;
            });
            const maxAchievableGradeResult = calculateOverallFinalGrade();
            targetAssignmentOriginalIndices.forEach((index, i) => { currentClassData[index].score = originalScores[i]; }); // Restore again

            //console.log(`[calculateMinScoreForAssignments] Failure. Desired grade ${desiredOverallGrade}% not achievable. Max overall with ${(maxTestPercentage*100).toFixed(2)}% on assignments: ${maxAchievableGradeResult.finalGrade !== null ? maxAchievableGradeResult.finalGrade.toFixed(2) : 'N/A'}%`);
            return {
                neededPercentage: null,
                isPossible: false,
                finalGradeAchieved: maxAchievableGradeResult.finalGrade !== null ? parseFloat(maxAchievableGradeResult.finalGrade.toFixed(2)) : null,
                individualResults: []
            };
        }
    }

    function displayNeededScoresForAllCutoffs() {
        console.log('[displayNeededScoresForAllCutoffs] Called.');
        if (!whatIfResultsDisplay) return;
        const selectedAssignmentIndices = getSelectedWhatIfAssignments();

        if (selectedAssignmentIndices.length === 0) {
            whatIfResultsDisplay.innerHTML = "<p>Please select one or more assignments using the checkboxes.</p>";
            return;
        }

        // Verify all selected assignments have valid points possible
        const selectedAssignmentNames = [];
        for (const index of selectedAssignmentIndices) {
            const assignment = currentClassData[index];
            selectedAssignmentNames.push(assignment.name);
            const pointsPossible = parseFloat(assignment.pointsPossible);
            if (isNaN(pointsPossible) || pointsPossible <= 0) {
                whatIfResultsDisplay.innerHTML = `<p>One of the selected assignments ("${assignment.name}") has invalid or zero points possible. Cannot perform calculation.</p>`;
                return;
            }
            console.log(`[displayNeededScoresForAllCutoffs] Selected assignment "${assignment.name}" has valid points possible: ${pointsPossible}`);
        }

        // Read the extra credit percentage from the input field
        let extraCreditValue = parseFloat(extraCreditInput_whatIf.value);
        if (isNaN(extraCreditValue) || extraCreditValue < 0) {
            console.warn("[displayNeededScoresForAllCutoffs] Invalid extra credit percentage input, defaulting to 0.");
            extraCreditValue = 0; // Default to 0 if input is invalid
            
        }
        console.log(`[displayNeededScoresForAllCutoffs] Extra credit percentage: ${extraCreditValue}%`);
        // Ensure the input field reflects the sanitized value if it was changed
        extraCreditInput_whatIf.value = extraCreditValue;

        const assignmentNamesText = selectedAssignmentNames.length > 1 ? 
            `assignments: ${selectedAssignmentNames.join(', ')}` : 
            `assignment: "${selectedAssignmentNames[0]}"`;
        whatIfResultsDisplay.innerHTML = `<h4>Needed scores for selected ${assignmentNamesText}, considering up to ${extraCreditValue}% extra (aiming for the same percentage on each):</h4>`;
        const ul = document.createElement('ul');

        const sortedCutoffs = Object.entries(currentClassCutoffs)
            .sort(([, valA], [, valB]) => valB - valA); // Highest grade first

        let anyCalculationDone = false;
        for (const [grade, cutoffPercentage] of sortedCutoffs) {
            if (cutoffPercentage === null || isNaN(cutoffPercentage)) continue;
            anyCalculationDone = true;

            const result = calculateMinScoreForAssignments(selectedAssignmentIndices, cutoffPercentage, extraCreditValue);
            console.log(`[displayNeededScoresForAllCutoffs] Grade: ${grade}, Cutoff: ${cutoffPercentage}, Result:`, result);
            const li = document.createElement('li');
            if (result.isPossible && result.neededPercentage !== null) {
                li.innerHTML = `To get a <strong>${grade}</strong> (&GreaterEqual;${cutoffPercentage}% overall): 
                              Need <strong>${result.neededPercentage.toFixed(2)}%</strong> on each selected assignment.
                              <small>(Actual overall: ${result.finalGradeAchieved !== null ? result.finalGradeAchieved.toFixed(2) : 'N/A'}%)</small>`;
                if (result.neededPercentage > 100) {
                    li.innerHTML += ` <strong style="color:orange;">(Requires extra credit)</strong>`;
                }
                const detailsUl = document.createElement('ul');
                detailsUl.style.fontSize = '0.9em';
                detailsUl.style.marginLeft = '20px';
                result.individualResults.forEach(asmRes => {
                    const detailLi = document.createElement('li');
                    detailLi.innerHTML = `<em>${asmRes.name}</em>: ${asmRes.neededScore.toFixed(2)} / ${asmRes.pointsPossible.toFixed(2)}`;
                    detailsUl.appendChild(detailLi);
                });
                li.appendChild(detailsUl);
            } else {
                li.innerHTML = `To get a <strong>${grade}</strong> (&GreaterEqual;${cutoffPercentage}% overall): 
                              <strong style="color:red;">Not possible.</strong> 
                              <small>(Max possible overall grade with ${ (100 + extraCreditValue).toFixed(0)}% on selected assignments: ${result.finalGradeAchieved !== null ? result.finalGradeAchieved.toFixed(2) : 'N/A'}%)</small>`;
            }
            ul.appendChild(li);
        }
         if (!anyCalculationDone) {
            whatIfResultsDisplay.innerHTML = "<p>No valid grade cutoffs defined to calculate against.</p>";
        } else {
             whatIfResultsDisplay.appendChild(ul);
        }
    }

    function populateFinalAssignmentSelector(selectorElement, categoryName) { // categoryName is not strictly needed now but kept for consistency if called elsewhere
        selectorElement.innerHTML = '<option value="">--Select Final Assignment--</option>';
        if (!currentClassData) return;

        currentClassData.forEach((asm, index) => {
            // Only include non-manually-excluded assignments as potential "finals"
            if (!asm.isExcluded) {
                const option = document.createElement('option');
                option.value = index; // originalIndex
                let scoreDisplay = asm.score !== null && asm.score !== undefined ? asm.score : 'NG';
                let possibleDisplay = asm.pointsPossible !== null && asm.pointsPossible !== undefined ? asm.pointsPossible : 'NP';
                option.textContent = `${asm.name} (Cat: ${asm.category || 'Uncategorized'}) - (${scoreDisplay}/${possibleDisplay})`;
                selectorElement.appendChild(option);
            }
        });
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
                //populateWhatIfAssignmentSelector(); // Update the what-if selector to reflect changes
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

        // Listener for what-if checkboxes
        gradesOutput.addEventListener('change', (event) => {
            if (event.target.classList.contains('what-if-assignment-checkbox')) {
                updateCalculateNeededButtonState();
                whatIfResultsDisplay.innerHTML = ''; // Clear previous results if selection changes
            }
        });
        
        if (saveCutoffsButton) saveCutoffsButton.addEventListener('click', saveCustomCutoffs);
        if (resetCutoffsButton) resetCutoffsButton.addEventListener('click', resetDefaultCutoffs);
        if (calculateNeededForCutoffsButton) calculateNeededForCutoffsButton.addEventListener('click', displayNeededScoresForAllCutoffs);
        if (clearWhatIfSelectionButton) clearWhatIfSelectionButton.addEventListener('click', clearWhatIfSelection);
        
         classSelector.addEventListener('change', (event) => {
            const selectedClass = event.target.value;
            currentClassNameForDisplay = selectedClass; // This is already set
            if (selectedClass) {
                displayGradesForClass(selectedClass, globalAllClassesData); // This will re-init everything
                resetWhatIfCalculator(); // Reset calculator on class change
                updateCalculateNeededButtonState();
            } else {
                gradesOutput.innerHTML = '<p>Please select a class to view its grades.</p>';
                currentClassData = null;
                deleteClassButton.style.display = 'none';
                if (overallGradeContainer) overallGradeContainer.style.display = 'none';
                if (gradeCutoffManagerDiv) gradeCutoffManagerDiv.style.display = 'none';
                if (whatIfCalculatorDiv) whatIfCalculatorDiv.style.display = 'none';
            }
        });

        gradesOutput.querySelectorAll('.category-replace-policy').forEach(select => {
            if (select.dataset.listenerAttached === 'true') return;
            select.addEventListener('change', (event) => {
                const categoryName = event.target.dataset.category;
                const policy = event.target.value;
                const categoryIdSafeForHtmlId = categoryName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
                const finalAssignmentSelectorContainer = document.getElementById(`final-assignment-selector-container-${categoryIdSafeForHtmlId}`);
                const includeLowestInAvgContainer = document.getElementById(`include-lowest-in-avg-container-${categoryIdSafeForHtmlId}`); // Get the new container

                if (!globalAllClassesData[classSettingsKey].categoryReplacePolicies) {
                    globalAllClassesData[classSettingsKey].categoryReplacePolicies = {};
                }
                if (!globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName]) {
                    // Initialize with includeLowestInAvg, defaulting to false (current behavior)
                    globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName] = { policy: 'none', finalAssignmentOriginalIndex: null, includeLowestInAvg: false };
                }
                globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].policy = policy;

                // Show/hide final assignment selector
                if (policy === 'finalReplacesLowest') {
                    finalAssignmentSelectorContainer.style.display = 'inline-block'; // Or 'flex'
                    populateFinalAssignmentSelector(finalAssignmentSelectorContainer.querySelector('.final-assignment-selector'), categoryName);
                    const savedFinalIndex = globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].finalAssignmentOriginalIndex;
                    if (savedFinalIndex !== null) {
                        finalAssignmentSelectorContainer.querySelector('.final-assignment-selector').value = savedFinalIndex;
                    }
                } else {
                    finalAssignmentSelectorContainer.style.display = 'none';
                    // globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].finalAssignmentOriginalIndex = null; // Reset if policy changes from this
                }

                // Show/hide "Include Lowest in Avg" checkbox container
                if (policy === 'replaceLowWithCategoryAverage') {
                    includeLowestInAvgContainer.style.display = 'inline-block'; // Or 'flex'
                    // Set checkbox state from saved settings
                    const includeLowestCheckbox = includeLowestInAvgContainer.querySelector('.include-lowest-in-avg-checkbox');
                    includeLowestCheckbox.checked = globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].includeLowestInAvg || false;
                } else {
                    includeLowestInAvgContainer.style.display = 'none';
                    // globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].includeLowestInAvg = false; // Reset if policy changes from this
                }

                debouncedSaveAllClassesData();
                updateCategoryDisplay(categoryName);
            });
            select.dataset.listenerAttached = 'true';
        });

        gradesOutput.querySelectorAll('.include-lowest-in-avg-checkbox').forEach(checkbox => {
            if (checkbox.dataset.listenerAttached === 'true') return;
            checkbox.addEventListener('change', (event) => {
                const categoryName = event.target.dataset.category;
                const isChecked = event.target.checked;

                if (globalAllClassesData[classSettingsKey]?.categoryReplacePolicies?.[categoryName]) {
                    globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].includeLowestInAvg = isChecked;
                    debouncedSaveAllClassesData();
                    updateCategoryDisplay(categoryName);
                }
            });
            checkbox.dataset.listenerAttached = 'true';
        });

        gradesOutput.querySelectorAll('.final-assignment-selector').forEach(select => {
            if (select.dataset.listenerAttached === 'true') return;
            select.addEventListener('change', (event) => {
                const categoryName = event.target.dataset.category;
                const finalAssignmentOriginalIndex = event.target.value ? parseInt(event.target.value, 10) : null;

                globalAllClassesData[classSettingsKey].categoryReplacePolicies[categoryName].finalAssignmentOriginalIndex = finalAssignmentOriginalIndex;
                debouncedSaveAllClassesData();
                updateCategoryDisplay(categoryName);
            });
            select.dataset.listenerAttached = 'true';
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

    function loadCategoryReplacePolicies(currentClassName) {
        const classSettingsKey = currentClassName + '_settings'; // Define classSettingsKey here
        const classSettings = globalAllClassesData[classSettingsKey];

        if (classSettings && classSettings.categoryReplacePolicies) {
            document.querySelectorAll('.category-replace-policy').forEach(select => {
                const categoryName = select.dataset.category;
                const policySettings = classSettings.categoryReplacePolicies[categoryName];
                const categoryIdSafeForHtmlId = categoryName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
                const finalAssignmentSelectorContainer = document.getElementById(`final-assignment-selector-container-${categoryIdSafeForHtmlId}`);
                const includeLowestInAvgContainer = document.getElementById(`include-lowest-in-avg-container-${categoryIdSafeForHtmlId}`);
                const includeLowestCheckbox = includeLowestInAvgContainer ? includeLowestInAvgContainer.querySelector('.include-lowest-in-avg-checkbox') : null;


                if (policySettings) {
                    select.value = policySettings.policy || 'none';

                    if (policySettings.policy === 'finalReplacesLowest') {
                        if (finalAssignmentSelectorContainer) finalAssignmentSelectorContainer.style.display = 'inline-block';
                        const finalSelector = finalAssignmentSelectorContainer ? finalAssignmentSelectorContainer.querySelector('.final-assignment-selector') : null;
                        if (finalSelector) {
                            populateFinalAssignmentSelector(finalSelector, categoryName); // Repopulate to be sure
                            finalSelector.value = policySettings.finalAssignmentOriginalIndex !== null ? policySettings.finalAssignmentOriginalIndex : "";
                        }
                    } else {
                        if (finalAssignmentSelectorContainer) finalAssignmentSelectorContainer.style.display = 'none';
                    }

                    if (policySettings.policy === 'replaceLowWithCategoryAverage') {
                        if (includeLowestInAvgContainer) includeLowestInAvgContainer.style.display = 'inline-block';
                        if (includeLowestCheckbox) includeLowestCheckbox.checked = policySettings.includeLowestInAvg || false;
                    } else {
                        if (includeLowestInAvgContainer) includeLowestInAvgContainer.style.display = 'none';
                    }
                } else { // Default UI state if no policy settings for category
                    select.value = 'none';
                    if (finalAssignmentSelectorContainer) finalAssignmentSelectorContainer.style.display = 'none';
                    if (includeLowestInAvgContainer) includeLowestInAvgContainer.style.display = 'none';
                }
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
            resetWhatIfCalculator();
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