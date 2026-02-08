import { Component, EventEmitter, Input, Output, OnInit, OnChanges, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { ReaderIconComponent } from '../../shared/icon.component';
import { SearchService, DictionaryDefinition } from './search.service';
import { Theme } from '../../state/themes.constant';

export type SearchMode = 'search' | 'dictionary' | 'wikipedia';

@Component({
    selector: 'app-search-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, ReaderIconComponent],
    templateUrl: './search-modal.component.html',
    styleUrls: ['./search-modal.component.scss']
})
export class SearchModalComponent implements OnInit, OnChanges, AfterViewInit {
    @Input() visible = false;
    @Input() searchText = '';
    @Input() initialMode: SearchMode = 'search';
    @Input() theme: Theme | null = null;
    @Output() close = new EventEmitter<void>();

    @ViewChild('searchContainer', { read: ElementRef }) searchContainer?: ElementRef;
    @ViewChild('wikipediaContainer', { read: ElementRef }) wikipediaContainer?: ElementRef;
    @ViewChild('searchInput', { read: ElementRef }) searchInput?: ElementRef;

    currentMode: SearchMode = 'search';
    isLoading = false;
    editableSearchText = '';

    // Dictionary results
    dictionaryResults: DictionaryDefinition[] = [];
    dictionaryError = false;

    // Cache for iframes to prevent reloads
    private googleIframeLoaded = false;
    private wikipediaIframeLoaded = false;
    private currentSearchText = '';

    constructor(
        private searchService: SearchService,
        private sanitizer: DomSanitizer
    ) { }

    ngOnInit(): void {
        this.currentMode = this.initialMode;
        this.editableSearchText = this.searchText;
        this.currentSearchText = this.searchText;
        if (this.visible && this.searchText) {
            this.performSearch();
        }
    }

    ngAfterViewInit(): void {
        if (this.visible && this.currentMode === 'search' && !this.googleIframeLoaded) {
            this.loadGoogleSearch();
        } else if (this.visible && this.currentMode === 'wikipedia' && !this.wikipediaIframeLoaded) {
            this.loadWikipediaSearch();
        }

        // Focus the search input
        if (this.searchInput) {
            setTimeout(() => this.searchInput?.nativeElement.focus(), 100);
        }
    }

    ngOnChanges(): void {
        // Only reload if search text changed or visibility changed from false to true
        if (this.visible && this.searchText && this.searchText !== this.currentSearchText) {
            this.editableSearchText = this.searchText;
            this.currentSearchText = this.searchText;
            this.currentMode = this.initialMode;
            this.resetAllCaches();
            this.performSearch();
        }
    }

    onSearchChange(): void {
        if (!this.editableSearchText.trim()) return;

        // Update the internal search text
        this.searchText = this.editableSearchText;
        this.currentSearchText = this.editableSearchText;

        // Reset all caches to reload with new query
        this.resetAllCaches();

        // Perform new search
        this.performSearch();
    }

    private resetAllCaches(): void {
        this.googleIframeLoaded = false;
        this.wikipediaIframeLoaded = false;
        this.dictionaryResults = [];
        this.dictionaryError = false;

        // Clear iframe containers
        if (this.searchContainer) {
            this.searchContainer.nativeElement.innerHTML = '';
        }
        if (this.wikipediaContainer) {
            this.wikipediaContainer.nativeElement.innerHTML = '';
        }
    }

    switchMode(mode: SearchMode): void {
        this.currentMode = mode;

        // Load content if not already loaded
        if (mode === 'dictionary' && this.dictionaryResults.length === 0 && !this.dictionaryError) {
            this.performSearch();
        } else if (mode === 'search' && !this.googleIframeLoaded) {
            setTimeout(() => this.loadGoogleSearch(), 50);
        } else if (mode === 'wikipedia' && !this.wikipediaIframeLoaded) {
            setTimeout(() => this.loadWikipediaSearch(), 50);
        }
    }

    performSearch(): void {
        if (!this.searchText.trim()) return;

        if (this.currentMode === 'dictionary') {
            this.isLoading = true;
            this.dictionaryError = false;

            const word = this.searchText.trim().split(/\s+/)[0].toLowerCase();
            this.searchService.getDictionaryDefinition(word).subscribe({
                next: (results) => {
                    this.dictionaryResults = results;
                    this.dictionaryError = results.length === 0;
                    this.isLoading = false;
                },
                error: () => {
                    this.dictionaryError = true;
                    this.isLoading = false;
                }
            });
        } else if (this.currentMode === 'search' && !this.googleIframeLoaded) {
            this.isLoading = false;
            setTimeout(() => this.loadGoogleSearch(), 100);
        } else if (this.currentMode === 'wikipedia' && !this.wikipediaIframeLoaded) {
            this.isLoading = false;
            setTimeout(() => this.loadWikipediaSearch(), 100);
        } else if (this.currentMode === 'wikipedia' && !this.wikipediaIframeLoaded) {
            this.isLoading = false;
            setTimeout(() => this.loadWikipediaSearch(), 100);
        }
    }

    private loadGoogleSearch(): void {
        if (!this.searchContainer || this.googleIframeLoaded) return;

        const container = this.searchContainer.nativeElement;

        if (container.children.length === 0) {
            const iframe = document.createElement('iframe');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.minHeight = '500px';

            const searchUrl = `https://www.google.com/search?igu=1&q=${encodeURIComponent(this.searchText)}`;
            iframe.src = searchUrl;

            container.appendChild(iframe);
            this.googleIframeLoaded = true;
        }
    }


    private loadWikipediaSearch(): void {
        if (!this.wikipediaContainer || this.wikipediaIframeLoaded) return;

        const container = this.wikipediaContainer.nativeElement;

        if (container.children.length === 0) {
            const iframe = document.createElement('iframe');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.minHeight = '500px';

            // Use mobile Wikipedia
            const searchUrl = `https://en.m.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(this.searchText)}`;
            iframe.src = searchUrl;

            // Inject dark mode CSS after iframe loads
            iframe.onload = () => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc && this.theme) {
                        const style = iframeDoc.createElement('style');
                        style.textContent = `
              body {
                background-color: ${this.theme.bg} !important;
                color: ${this.theme.fg} !important;
              }
              .mw-body, .content, #content, .mw-page-container {
                background-color: ${this.theme.bg} !important;
                color: ${this.theme.fg} !important;
              }
              a { color: ${this.theme.link} !important; }
              .infobox, .wikitable, .navbox {
                background-color: ${this.adjustOpacity(this.theme.fg!, 0.05)} !important;
                color: ${this.theme.fg} !important;
              }
            `;
                        iframeDoc.head.appendChild(style);
                    }
                } catch (e) {
                    // CORS restriction - can't inject CSS
                    console.log('Cannot inject dark mode CSS due to CORS');
                }
            };

            container.appendChild(iframe);
            this.wikipediaIframeLoaded = true;
        }
    }

    onClose(): void {
        this.resetAllCaches();
        this.close.emit();
    }

    onBackdropClick(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.onClose();
        }
    }

    playAudio(audioUrl: string): void {
        const audio = new Audio(audioUrl);
        audio.play();
    }

    // Use theme colors directly
    getModalStyles(): any {
        if (!this.theme) return {};
        return {
            'background-color': this.theme.bg,
            'color': this.theme.fg
        };
    }

    getHeaderStyles(): any {
        if (!this.theme) return {};
        return {
            'background-color': this.theme.bg,
            'color': this.theme.fg,
            'border-bottom': `1px solid ${this.adjustOpacity(this.theme.fg!, 0.1)}`
        };
    }

    getTabStyles(): any {
        if (!this.theme) return {};
        return {
            'background-color': this.theme.bg,
            'color': this.theme.fg,
            'border-bottom': `1px solid ${this.adjustOpacity(this.theme.fg!, 0.1)}`
        };
    }

    getTextStyles(): any {
        if (!this.theme) return {};
        return {
            'color': this.theme.fg
        };
    }

    getContentStyles(): any {
        if (!this.theme) return {};
        return {
            'background-color': this.theme.bg,
            'color': this.theme.fg
        };
    }

    getLinkColor(): string {
        return this.theme?.link || '#2563eb';
    }

    getBorderRight(): string {
        if (!this.theme) return '1px solid rgba(128, 128, 128, 0.2)';
        return `1px solid ${this.adjustOpacity(this.theme.fg!, 0.15)}`;
    }

    private adjustOpacity(color: string, opacity: number): string {
        if (color.startsWith('#')) {
            const hex = color.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }
        return color;
    }
}
