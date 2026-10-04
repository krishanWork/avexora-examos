import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Building2, Loader2, X, Check, Globe } from "lucide-react";
import { appClient } from "@/api/appClient";

export default function InstitutionLookupDialog({ open, onOpenChange, onSelect, currentPicked }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  // Debounced search when user types 2 or more characters
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearched(false);
      setError("");
      return;
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      setSearched(true);
      try {
        const { data } = await appClient.functions.invoke("publicSite", {
          action: "lookup",
          school: query.trim(),
        });
        setResults(data?.tenants || []);
      } catch (err) {
        setError(err.message || "Failed to search institutions");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query]);

  const handlePick = (tenant) => {
    onSelect(tenant);
    onOpenChange(false);
  };

  const handleClear = () => {
    onSelect(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0 rounded-2xl border-border bg-card">
        <DialogHeader className="p-5 pb-3 border-b border-border/80">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            Find Your Institution
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Search for your school, college, or examination center to access your branded portal.
          </DialogDescription>
        </DialogHeader>

        {/* Search Input Bar */}
        <div className="p-4 border-b border-border/60 bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="text"
              autoFocus
              placeholder="Search by school name or domain..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-9 h-11 bg-background text-sm rounded-xl border-border focus-visible:ring-1 focus-visible:ring-primary"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Results List */}
        <div className="max-h-[320px] overflow-y-auto p-2 divide-y divide-border/40">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-xs">Searching directory...</span>
            </div>
          )}

          {!loading && error && (
            <div className="p-4 text-center text-xs text-destructive">
              {error}
            </div>
          )}

          {!loading && !searched && query.trim().length < 2 && (
            <div className="py-10 px-4 text-center text-muted-foreground">
              <Globe className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-xs font-medium">Type at least 2 characters to search</p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">e.g., "Delhi Public", "St. Xavier", or a custom domain</p>
            </div>
          )}

          {!loading && searched && results.length === 0 && !error && (
            <div className="py-10 px-4 text-center">
              <p className="text-sm font-medium text-foreground">No institutions found</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Could not find any institution matching "{query}". You can still log in directly using your personal account.
              </p>
            </div>
          )}

          {!loading && results.map((tenant) => {
            const isSelected = currentPicked?.id === tenant.id;
            return (
              <button
                key={tenant.id}
                type="button"
                onClick={() => handlePick(tenant)}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors text-left hover:bg-muted/70 group ${
                  isSelected ? "bg-primary/5 border border-primary/20" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center shrink-0 overflow-hidden shadow-2xs group-hover:border-primary/40 transition-colors">
                    {tenant.logo_url ? (
                      <img src={tenant.logo_url} alt={tenant.name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <Building2 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {tenant.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {(tenant.custom_domain || tenant.subdomain) + (tenant.city ? ` · ${tenant.city}` : "")}
                    </p>
                  </div>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between text-xs">
          {currentPicked ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-xs text-muted-foreground hover:text-destructive h-8"
            >
              Clear selection (Platform login)
            </Button>
          ) : (
            <span className="text-muted-foreground text-[11px]">Optional: Leave empty for platform admin or direct login</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs h-8 ml-auto"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
