// Zero-Vector-3 Tutorial Website - Interactive Functionality

document.addEventListener('DOMContentLoaded', function() {
    // Initialize all interactive features
    initializeAnimations();
    initializeCardHovers();
    initializeProgressTracking();
    initializeThemeToggle();
    initializeSearchFunctionality();
    initializeLessonProgress();
    initializeAccessibility();
});

/**
 * Initialize scroll-based animations
 */
function initializeAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    }, observerOptions);

    // Observe all cards and sections
    document.querySelectorAll('.lesson-card, .advanced-card, .intro').forEach(el => {
        observer.observe(el);
    });
}

/**
 * Enhanced card hover effects
 */
function initializeCardHovers() {
    const cards = document.querySelectorAll('.lesson-card, .advanced-card');
    
    cards.forEach(card => {
        card.addEventListener('mouseenter', function(e) {
            // Add subtle parallax effect
            this.style.transform = 'translateY(-5px) rotateX(2deg)';
            
            // Highlight related cards
            const difficulty = this.querySelector('.difficulty')?.textContent;
            if (difficulty) {
                cards.forEach(otherCard => {
                    const otherDifficulty = otherCard.querySelector('.difficulty')?.textContent;
                    if (otherDifficulty === difficulty && otherCard !== this) {
                        otherCard.style.opacity = '0.7';
                    }
                });
            }
        });

        card.addEventListener('mouseleave', function(e) {
            this.style.transform = '';
            cards.forEach(otherCard => {
                otherCard.style.opacity = '';
            });
        });

        // Add click tracking
        card.addEventListener('click', function(e) {
            if (e.target.tagName !== 'A') {
                const link = this.querySelector('.btn');
                if (link) {
                    trackLessonClick(link.href, this.querySelector('.lesson-title')?.textContent);
                }
            }
        });
    });
}

/**
 * Progress tracking system
 */
function initializeProgressTracking() {
    const progressKey = 'zv3-tutorial-progress';
    let progress = JSON.parse(localStorage.getItem(progressKey) || '{}');

    // Create progress indicator
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    progressContainer.innerHTML = `
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${calculateProgress()}%"></div>
        </div>
        <div class="progress-text">
            ${Object.keys(progress).length} of ${document.querySelectorAll('.lesson-card').length} lessons completed
        </div>
    `;

    // Insert after intro
    const intro = document.querySelector('.intro');
    if (intro) {
        intro.parentNode.insertBefore(progressContainer, intro.nextSibling);
    }

    // Mark completed lessons
    Object.keys(progress).forEach(lessonId => {
        const card = document.querySelector(`[data-lesson="${lessonId}"]`);
        if (card) {
            card.classList.add('completed');
            card.insertAdjacentHTML('beforeend', '<div class="completion-badge">✓</div>');
        }
    });

    function calculateProgress() {
        const total = document.querySelectorAll('.lesson-card').length;
        const completed = Object.keys(progress).length;
        return total > 0 ? Math.round((completed / total) * 100) : 0;
    }

    // Add CSS for progress tracking
    if (!document.querySelector('#progress-styles')) {
        const style = document.createElement('style');
        style.id = 'progress-styles';
        style.textContent = `
            .progress-container {
                margin: 2rem 0;
                padding: 1.5rem;
                background: var(--secondary-bg);
                border-radius: 0.5rem;
                border: 1px solid var(--border-color);
            }
            .progress-bar {
                width: 100%;
                height: 8px;
                background: var(--accent-bg);
                border-radius: 4px;
                overflow: hidden;
                margin-bottom: 0.5rem;
            }
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--accent-color), #74b9ff);
                transition: width 0.3s ease;
            }
            .progress-text {
                font-size: 0.9rem;
                color: var(--text-secondary);
                text-align: center;
            }
            .lesson-card.completed {
                border-color: var(--success-color);
                position: relative;
            }
            .completion-badge {
                position: absolute;
                top: 1rem;
                right: 1rem;
                width: 30px;
                height: 30px;
                background: var(--success-color);
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 0.8rem;
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Theme toggle functionality
 */
function initializeThemeToggle() {
    // Create theme toggle button
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    themeToggle.setAttribute('aria-label', 'Toggle theme');
    themeToggle.title = 'Toggle light/dark theme';
    
    document.body.appendChild(themeToggle);

    // Check for saved theme preference
    const savedTheme = localStorage.getItem('zv3-theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        
        themeToggle.innerHTML = isLight ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        localStorage.setItem('zv3-theme', isLight ? 'light' : 'dark');
        
        // Animate the transition
        themeToggle.style.transform = 'scale(0.8)';
        setTimeout(() => {
            themeToggle.style.transform = 'scale(1)';
        }, 150);
    });
}

/**
 * Search functionality
 */
function initializeSearchFunctionality() {
    // Create search bar
    const searchContainer = document.createElement('div');
    searchContainer.className = 'search-container';
    searchContainer.innerHTML = `
        <div class="search-wrapper">
            <input type="text" class="search-input" placeholder="Search lessons..." aria-label="Search lessons">
            <i class="fas fa-search search-icon"></i>
            <button class="search-clear" aria-label="Clear search">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="search-results hidden"></div>
    `;

    // Insert search after intro
    const intro = document.querySelector('.intro');
    if (intro) {
        intro.parentNode.insertBefore(searchContainer, intro.nextSibling);
    }

    const searchInput = searchContainer.querySelector('.search-input');
    const searchClear = searchContainer.querySelector('.search-clear');
    const searchResults = searchContainer.querySelector('.search-results');
    const lessonCards = document.querySelectorAll('.lesson-card');

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length === 0) {
            showAllLessons();
            searchResults.classList.add('hidden');
            searchClear.style.display = 'none';
            return;
        }

        searchClear.style.display = 'block';
        filterLessons(query);
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        showAllLessons();
        searchResults.classList.add('hidden');
        searchClear.style.display = 'none';
        searchInput.focus();
    });

    function filterLessons(query) {
        let hasResults = false;
        
        lessonCards.forEach(card => {
            const title = card.querySelector('.lesson-title')?.textContent.toLowerCase() || '';
            const description = card.querySelector('.lesson-description')?.textContent.toLowerCase() || '';
            const difficulty = card.querySelector('.difficulty')?.textContent.toLowerCase() || '';
            
            const matches = title.includes(query) || description.includes(query) || difficulty.includes(query);
            
            if (matches) {
                card.style.display = 'block';
                card.classList.add('search-highlight');
                hasResults = true;
            } else {
                card.style.display = 'none';
                card.classList.remove('search-highlight');
            }
        });

        // Show no results message
        if (!hasResults) {
            searchResults.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>No lessons found for "${query}"</p>
                    <small>Try searching for "beginner", "workflow", or "persona"</small>
                </div>
            `;
            searchResults.classList.remove('hidden');
        } else {
            searchResults.classList.add('hidden');
        }
    }

    function showAllLessons() {
        lessonCards.forEach(card => {
            card.style.display = 'block';
            card.classList.remove('search-highlight');
        });
    }

    // Add search styles
    if (!document.querySelector('#search-styles')) {
        const style = document.createElement('style');
        style.id = 'search-styles';
        style.textContent = `
            .search-container {
                margin: 2rem 0;
                position: relative;
            }
            .search-wrapper {
                position: relative;
                max-width: 400px;
                margin: 0 auto;
            }
            .search-input {
                width: 100%;
                padding: 0.75rem 2.5rem 0.75rem 1rem;
                background: var(--card-bg);
                border: 1px solid var(--border-color);
                border-radius: 0.5rem;
                color: var(--text-primary);
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            .search-input:focus {
                outline: none;
                border-color: var(--accent-color);
                box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.1);
            }
            .search-icon {
                position: absolute;
                right: 1rem;
                top: 50%;
                transform: translateY(-50%);
                color: var(--text-muted);
                pointer-events: none;
            }
            .search-clear {
                position: absolute;
                right: 0.5rem;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                padding: 0.25rem;
                border-radius: 0.25rem;
                display: none;
            }
            .search-clear:hover {
                color: var(--error-color);
                background: var(--accent-bg);
            }
            .search-results {
                margin-top: 1rem;
                padding: 1rem;
                background: var(--card-bg);
                border: 1px solid var(--border-color);
                border-radius: 0.5rem;
            }
            .search-results.hidden {
                display: none;
            }
            .no-results {
                text-align: center;
                color: var(--text-muted);
            }
            .no-results i {
                font-size: 2rem;
                margin-bottom: 1rem;
                display: block;
            }
            .search-highlight {
                animation: searchHighlight 0.3s ease;
            }
            @keyframes searchHighlight {
                0% { transform: scale(1); }
                50% { transform: scale(1.02); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Lesson progress tracking
 */
function initializeLessonProgress() {
    const links = document.querySelectorAll('.btn[href*="lessons/"]');
    
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            const lessonName = this.href.split('/').pop().replace('.html', '');
            trackLessonStart(lessonName);
        });
    });
}

/**
 * Accessibility enhancements
 */
function initializeAccessibility() {
    // Add keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            document.body.classList.add('keyboard-nav');
        }
    });

    document.addEventListener('mousedown', function() {
        document.body.classList.remove('keyboard-nav');
    });

    // Add skip link
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.className = 'skip-link';
    skipLink.textContent = 'Skip to main content';
    document.body.insertBefore(skipLink, document.body.firstChild);

    // Add landmark to main content
    const main = document.querySelector('.main');
    if (main) {
        main.id = 'main-content';
        main.setAttribute('role', 'main');
    }

    // Add accessibility styles
    if (!document.querySelector('#a11y-styles')) {
        const style = document.createElement('style');
        style.id = 'a11y-styles';
        style.textContent = `
            .skip-link {
                position: absolute;
                top: -40px;
                left: 6px;
                background: var(--accent-color);
                color: var(--primary-bg);
                padding: 8px;
                text-decoration: none;
                border-radius: 0 0 4px 4px;
                z-index: 1000;
                font-weight: bold;
            }
            .skip-link:focus {
                top: 0;
            }
            .keyboard-nav .lesson-card:focus,
            .keyboard-nav .advanced-card:focus,
            .keyboard-nav .btn:focus {
                outline: 3px solid var(--accent-color);
                outline-offset: 2px;
            }
            @media (prefers-reduced-motion: reduce) {
                * {
                    animation-duration: 0.01ms !important;
                    animation-iteration-count: 1 !important;
                    transition-duration: 0.01ms !important;
                    scroll-behavior: auto !important;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Analytics and tracking functions
 */
function trackLessonClick(url, title) {
    console.log(`Lesson clicked: ${title} (${url})`);
    
    // Store in local analytics
    const analytics = JSON.parse(localStorage.getItem('zv3-analytics') || '{}');
    const today = new Date().toISOString().split('T')[0];
    
    if (!analytics[today]) {
        analytics[today] = {};
    }
    
    if (!analytics[today].lessons) {
        analytics[today].lessons = {};
    }
    
    analytics[today].lessons[title] = (analytics[today].lessons[title] || 0) + 1;
    localStorage.setItem('zv3-analytics', JSON.stringify(analytics));
}

function trackLessonStart(lessonName) {
    const startTime = Date.now();
    localStorage.setItem(`zv3-lesson-start-${lessonName}`, startTime);
}

function trackLessonComplete(lessonName) {
    const startTime = localStorage.getItem(`zv3-lesson-start-${lessonName}`);
    if (startTime) {
        const duration = Date.now() - parseInt(startTime);
        console.log(`Lesson completed: ${lessonName} (${Math.round(duration / 1000)}s)`);
        
        // Mark as completed
        const progress = JSON.parse(localStorage.getItem('zv3-tutorial-progress') || '{}');
        progress[lessonName] = {
            completed: Date.now(),
            duration: duration
        };
        localStorage.setItem('zv3-tutorial-progress', JSON.stringify(progress));
        
        // Clean up start time
        localStorage.removeItem(`zv3-lesson-start-${lessonName}`);
    }
}

/**
 * Performance monitoring
 */
function initializePerformanceMonitoring() {
    // Monitor page load performance
    window.addEventListener('load', function() {
        setTimeout(() => {
            if (window.performance && window.performance.timing) {
                const timing = window.performance.timing;
                const loadTime = timing.loadEventEnd - timing.navigationStart;
                console.log(`Page load time: ${loadTime}ms`);
                
                // Store performance metrics
                const perf = JSON.parse(localStorage.getItem('zv3-performance') || '[]');
                perf.push({
                    timestamp: Date.now(),
                    loadTime: loadTime,
                    page: window.location.pathname
                });
                
                // Keep only last 50 entries
                if (perf.length > 50) {
                    perf.splice(0, perf.length - 50);
                }
                
                localStorage.setItem('zv3-performance', JSON.stringify(perf));
            }
        }, 0);
    });
}

// Initialize performance monitoring
initializePerformanceMonitoring();

// Expose utility functions globally
window.ZV3Tutorial = {
    trackLessonComplete,
    trackLessonStart,
    trackLessonClick
};

// Service worker registration for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
            .then(function(registration) {
                console.log('ServiceWorker registration successful');
            })
            .catch(function(err) {
                console.log('ServiceWorker registration failed');
            });
    });
}
