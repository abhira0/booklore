import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface DictionaryDefinition {
    word: string;
    phonetic?: string;
    phonetics: Array<{
        text?: string;
        audio?: string;
    }>;
    meanings: Array<{
        partOfSpeech: string;
        definitions: Array<{
            definition: string;
            example?: string;
            synonyms?: string[];
            antonyms?: string[];
        }>;
    }>;
}

export interface SearchResult {
    title: string;
    snippet: string;
    url?: string;
}

@Injectable({
    providedIn: 'root'
})
export class SearchService {
    constructor(private http: HttpClient) { }

    /**
     * Fetch dictionary definition from Free Dictionary API
     */
    getDictionaryDefinition(word: string): Observable<DictionaryDefinition[]> {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
        return this.http.get<DictionaryDefinition[]>(url).pipe(
            catchError(() => of([]))
        );
    }

    /**
     * Fetch instant answer from DuckDuckGo API
     */
    getInstantAnswer(query: string): Observable<SearchResult[]> {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        return this.http.jsonp(url, 'callback').pipe(
            map((response: any) => {
                const results: SearchResult[] = [];

                // Add abstract if available
                if (response.Abstract) {
                    results.push({
                        title: response.Heading || query,
                        snippet: response.Abstract,
                        url: response.AbstractURL
                    });
                }

                // Add related topics
                if (response.RelatedTopics && response.RelatedTopics.length > 0) {
                    response.RelatedTopics.slice(0, 5).forEach((topic: any) => {
                        if (topic.Text && topic.FirstURL) {
                            results.push({
                                title: topic.Text.split(' - ')[0] || topic.Text,
                                snippet: topic.Text,
                                url: topic.FirstURL
                            });
                        }
                    });
                }

                return results;
            }),
            catchError(() => of([]))
        );
    }

    /**
     * Generate Google search URL for fallback
     */
    getGoogleSearchUrl(query: string): string {
        return `https://www.google.com/search?q=${encodeURIComponent(query)}&cs=1&pccc=1`;
    }
}
